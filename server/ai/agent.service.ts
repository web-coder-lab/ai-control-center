import crypto from 'node:crypto';
import fs from 'node:fs';
import { db } from '../database/db.js';
import { decryptSecret, redactSecrets } from '../security/vault.js';
import { getProviderAdapter } from '../providers/index.js';
import { verifyGitHubRenderRelationship, classifyDeploymentLogs } from '../deployment/relationship.engine.js';
import { browserManager } from '../browser/browser.manager.js';
import { evaluateCostPolicy } from '../free-service/cost-guard.js';
import { taskEngine } from '../tasks/task.engine.js';
import { pushProjectArchiveToGitHub } from '../deployment/archive.pusher.js';
import { resolveRenderWorkspace, renderWorkspaceById, renderWorkspaceOwns } from '../providers/render/workspace.js';
import type { GatewayKey, Project, ProviderConnection } from '../../shared/types.js';

export const ControlOrchestrator = Object.freeze({
  id: 'control-orchestrator',
  name: 'Control Orchestrator',
  version: '2.0.0',
  modelDependency: 'none — awaiting user-owned AI brain',
});

type ToolResult = { message?: string; [key: string]: any };

const requiredCapabilityForTool: Record<string, string | undefined> = {
  list_github_accounts: 'github.account.read',
  list_repositories: 'github.repository.list',
  create_repository: 'github.repository.create',
  push_project_archive: 'github.repository.write',
  read_file: 'github.file.read',
  write_file: 'github.file.write',
  delete_repository: 'github.repository.delete',
  list_render_services: 'render.service.list',
  deploy_render_service: 'render.deploy',
  create_render_service: 'render.service.create',
  configure_render_service: 'render.service.configure',
  list_render_env: 'render.service.read',
  set_render_env: 'render.service.configure',
  delete_render_env: 'render.service.configure',
  list_render_domains: 'render.domain.read',
  add_render_domain: 'render.domain.write',
  verify_render_domain: 'render.domain.write',
  delete_render_domain: 'render.domain.write',
  rollback_render_deployment: 'render.rollback',
  restart_render_service: 'render.restart',
  delete_render_service: 'render.service.delete',
  get_render_logs: 'render.logs',
  check_relationship: 'github.repository.read',
  system_audit: 'system.audit',
  analyze_project: 'project.read',
  browser_navigate: 'browser.navigate',
  browser_back: 'browser.navigate',
  browser_forward: 'browser.navigate',
  browser_refresh: 'browser.navigate',
  browser_open_tab: 'browser.tabs',
  browser_switch_tab: 'browser.tabs',
  browser_close_tab: 'browser.tabs',
  browser_click: 'browser.click',
  browser_type: 'browser.type',
  browser_copy: 'browser.copy',
  browser_paste: 'browser.paste',
  browser_scroll: 'browser.scroll',
  browser_tabs: 'browser.tabs',
  browser_screenshot: 'browser.screenshot',
  browser_read_page: 'browser.read_page',
  browser_handoff: 'browser.human_handoff',
  check_free_option: undefined,
  request_add_api_token: 'gateway.token.request',
  list_connections: 'gateway.connections.read',
  list_gateway_activity: 'gateway.activity.read',
};

function connectionAllowed(key: GatewayKey | undefined, conn: ProviderConnection) {
  if (!key) return true;
  if (key.allowedProviders?.length && !key.allowedProviders.includes(conn.provider)) return false;
  if (key.allowedAccounts?.length && !key.allowedAccounts.includes(conn.id) && !key.allowedAccounts.includes(conn.accountId || '')) return false;
  return true;
}

function browserAllowed(key: GatewayKey | undefined, sessionId: string) {
  if (!key) return true;
  return !key.allowedBrowserSessions?.length || key.allowedBrowserSessions.includes(sessionId);
}

function ensureCapability(key: GatewayKey | undefined, toolName: string) {
  if (!key) return;
  const required = toolName === 'check_relationship'
    ? ['github.repository.read', 'render.service.read']
    : toolName === 'create_render_service'
      ? ['render.service.create', 'github.repository.read']
      : [requiredCapabilityForTool[toolName]].filter(Boolean) as string[];
  if (!required.length) throw new Error(`Tool "${toolName}" is not exposed through the Gateway.`);
  const missing = required.filter((capability) => key.capabilities?.[capability] !== true);
  if (missing.length) throw new Error(`Required capability not granted to this Gateway key: ${missing.join(', ')}.`);
}

function findConnection(provider: string, message: string, key?: GatewayKey) {
  const conns = db.getConnections(provider).filter((c) => connectionAllowed(key, c));
  if (!conns.length) throw new Error(`No authorized ${provider} connection is available.`);
  const lower = message.toLowerCase();
  const exact = conns.find((c) => [c.id, c.accountName, c.username, c.label, c.accountId].filter(Boolean).some((v) => lower.includes(String(v).toLowerCase())));
  if (exact) return exact;
  if (conns.length === 1) return conns[0];
  throw new Error(`Multiple ${provider} accounts match. Tell me the exact account name or ID so I do not guess.`);
}

function findGithub(message: string, key?: GatewayKey) { return findConnection('github', message, key); }
function findRender(message: string, key?: GatewayKey) { return findConnection('render', message, key); }

function activityProviderForTool(toolName: string): string | undefined {
  if (toolName.includes('github') || toolName.includes('repository') || toolName.includes('file') || toolName.includes('push_project_archive')) return 'github';
  if (toolName.includes('render')) return 'render';
  if (toolName.includes('browser')) return 'browser';
  if (toolName.includes('gateway')) return 'gateway';
  return undefined;
}

function activityAccountForTool(toolName: string, args: any): { provider?: string; account?: string } {
  const provider = activityProviderForTool(toolName);
  if (!provider) return {};
  const ids = [args?.accountId, args?.githubAccountId, args?.renderWorkspaceId, args?.providerAccountId].filter(Boolean).map(String);
  const names: string[] = [];
  for (const id of ids) {
    const conn = db.getConnectionById(id);
    if (conn) names.push(conn.accountName || conn.username || id);
  }
  if (names.length) return { provider, account: [...new Set(names)].join(' + ') };
  return { provider };
}

function resolveRenderOwnerId(conn: ProviderConnection, requestedId?: string): string { return resolveRenderWorkspace(conn, requestedId).id; }

async function assertRenderServiceAuthorized(conn: ProviderConnection, serviceId: string, adapter: any, secret: string) {
  if (!serviceId) throw new Error('Render service ID is required.');
  const service = await adapter.getResource(secret, 'service', serviceId);
  const ownerId = service?.ownerId || service?.owner_id || service?.owner?.id || service?.service?.ownerId || service?.service?.owner_id;
  if (!ownerId || !renderWorkspaceOwns(conn, String(ownerId))) throw new Error('Render service belongs to a workspace that is not available through the selected Render API key.');
  return service;
}

export function planForMessage(message: string): string[] {
  const lower = message.toLowerCase();
  if (lower.includes('deploy') || lower.includes('zip')) {
    return ['Understand project', 'Resolve provider accounts', 'Verify repository relationship', 'Deploy', 'Monitor result', 'Record proof'];
  }
  if (lower.includes('delete') || lower.includes('remove')) {
    return ['Identify exact resource', 'Verify owner and scope', 'Request confirmation', 'Execute deletion', 'Verify removal'];
  }
  if (lower.includes('browser') || lower.includes('chrome') || lower.includes('gmail')) {
    return ['Identify browser session', 'Verify browser capability', 'Navigate', 'Verify page state', 'Record activity'];
  }
  return ['Understand request', 'Resolve accounts and permissions', 'Execute authorized operation', 'Verify result', 'Record activity'];
}

function mutationLockKey(toolName: string, args: any): string | undefined {
  const mutating = new Set(['create_repository','push_project_archive','delete_repository','create_render_service','configure_render_service','set_render_env','delete_render_env','add_render_domain','verify_render_domain','delete_render_domain','deploy_render_service','restart_render_service','delete_render_service','rollback_render_deployment']);
  if (!mutating.has(toolName)) return undefined;
  if (args.serviceId) return `service:${String(args.serviceId)}`;
  if (args.owner && args.repo) return `repo:${String(args.owner).toLowerCase()}/${String(args.repo).toLowerCase()}`;
  if (args.accountId) return `account:${String(args.accountId)}:${toolName}`;
  return `tool:${toolName}`;
}

export async function executeToolCall(toolName: string, args: any = {}, actor = 'Main AI', gatewayKey?: GatewayKey): Promise<ToolResult> {
  const started = Date.now();
  const requestId = `req_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const lockKey = mutationLockKey(toolName, args);
  if (lockKey && !taskEngine.acquireLock(lockKey)) {
    const message = `This resource is already being modified by another task: ${lockKey}. I will not run the conflicting action concurrently.`;
    const lockContext = activityAccountForTool(toolName, args);
    db.addActivityLog({ id:`log_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`, timestamp:new Date().toISOString(), requestId, actor, agentId:gatewayKey?.id || ControlOrchestrator.id, gatewayKeyId:gatewayKey?.id, provider:lockContext.provider, account:lockContext.account, operation:toolName, target:args.target || args.repo || args.serviceId, capability:requiredCapabilityForTool[toolName], status:'blocked', durationMs:Date.now()-started, errorCategory:'RESOURCE_LOCKED', safeErrorMessage:message });
    throw new Error(message);
  }
  try {
    ensureCapability(gatewayKey, toolName);
    let result: ToolResult;
    switch (toolName) {
      case 'list_connections': {
        result = { connections: db.getConnections().filter((c) => connectionAllowed(gatewayKey, c)).map((c) => ({ id:c.id, provider:c.provider, name:c.accountName, username:c.username, accountId:c.accountId, description:c.description, howToUse:c.howToUse, status:c.status, lastCheckedAt:c.lastCheckedAt, lastUsedAt:c.lastUsedAt })) };
        break;
      }
      case 'list_github_accounts': {
        result = {
          accounts: db.getConnections('github').filter((c) => connectionAllowed(gatewayKey, c)).map((c) => ({
            id: c.id, name: c.accountName, username: c.username, accountId: c.accountId, status: c.status, permissions: c.permissions, rateLimit: c.rateLimit,
          })),
        };
        break;
      }
      case 'list_repositories': {
        const conn = db.getConnectionById(args.accountId) || findGithub(args.message || '', gatewayKey);
        if (!connectionAllowed(gatewayKey, conn)) throw new Error('Gateway key is not authorized for this GitHub account.');
        const secret = decryptSecret(db.getEncryptedSecret(conn.id) || '');
        result = { account: conn.accountName, repositories: await getProviderAdapter('github').listResources(secret, 'repositories', { page: 1, perPage: 100 }) };
        break;
      }
      case 'create_repository': {
        const conn = db.getConnectionById(args.accountId) || findGithub(args.message || '', gatewayKey);
        if (!connectionAllowed(gatewayKey, conn)) throw new Error('Gateway key is not authorized for this GitHub account.');
        const secret = decryptSecret(db.getEncryptedSecret(conn.id) || '');
        const created = await getProviderAdapter('github').performAction(secret, 'create_repository', { name: args.name, description: args.description, isPrivate: args.isPrivate ?? true, autoInit: args.autoInit ?? true });
        result = { account: conn.accountName, repository: { name: created.name, fullName: created.full_name, htmlUrl: created.html_url, defaultBranch: created.default_branch } };
        break;
      }
      case 'delete_repository': {
        if (!args.confirmed) throw new Error('Confirmation is required before deleting a GitHub repository.');
        const conn = db.getConnectionById(args.accountId) || findGithub(args.message || '', gatewayKey);
        if (!connectionAllowed(gatewayKey, conn)) throw new Error('Gateway key is not authorized for this GitHub account.');
        const owner = args.owner || conn.username;
        if (!owner || !args.repo) throw new Error('Repository owner and name are required.');
        const secret = decryptSecret(db.getEncryptedSecret(conn.id) || '');
        const adapter = getProviderAdapter('github');
        await adapter.getResource(secret, 'repository', `${owner}/${args.repo}`);
        const deleted = await adapter.performAction(secret, 'delete_repository', { owner, repo: args.repo });
        try { await adapter.getResource(secret, 'repository', `${owner}/${args.repo}`); throw new Error('GitHub did not confirm repository removal yet.'); } catch (e: any) {
          if (!String(e.message).includes('not found')) throw e;
        }
        result = { ...deleted, verified: true };
        break;
      }
      case 'read_file': {
        const conn = db.getConnectionById(args.accountId) || findGithub(args.message || '', gatewayKey);
        if (!connectionAllowed(gatewayKey, conn)) throw new Error('Gateway key is not authorized for this GitHub account.');
        const owner = String(args.owner || conn.username || '');
        const repo = String(args.repo || '');
        const filePath = String(args.path || '');
        if (!owner || !repo || !filePath) throw new Error('GitHub owner, repository and file path are required.');
        const secret = decryptSecret(db.getEncryptedSecret(conn.id) || '');
        const resourceId = `${owner}/${repo}/${filePath}`;
        const file = await getProviderAdapter('github').getResource(secret, 'file', resourceId);
        result = { account: conn.accountName, file: { path:file.path, sha:file.sha, size:file.size, encoding:file.encoding, content:file.decodedContent, htmlUrl:file.html_url, downloadUrl:file.download_url } };
        break;
      }
      case 'write_file': {
        const conn = db.getConnectionById(args.accountId) || findGithub(args.message || '', gatewayKey);
        if (!connectionAllowed(gatewayKey, conn)) throw new Error('Gateway key is not authorized for this GitHub account.');
        const owner = String(args.owner || conn.username || '');
        const repo = String(args.repo || '');
        const filePath = String(args.path || '');
        if (!owner || !repo || !filePath) throw new Error('GitHub owner, repository and file path are required.');
        if (typeof args.content !== 'string' && typeof args.contentBase64 !== 'string') throw new Error('File content is required.');
        const secret = decryptSecret(db.getEncryptedSecret(conn.id) || '');
        const adapter = getProviderAdapter('github');
        const existing = await adapter.getResource(secret, 'file', `${owner}/${repo}/${filePath}`).catch(() => null);
        const updated = await adapter.performAction(secret, 'create_or_update_file', { owner, repo, path:filePath, content:args.content, contentBase64:args.contentBase64, message:args.message, branch:args.branch || 'main', sha:args.sha || existing?.sha });
        const verified = await adapter.getResource(secret, 'file', `${owner}/${repo}/${filePath}`);
        result = { account: conn.accountName, file: { path:verified.path, sha:verified.sha, htmlUrl:verified.html_url }, commit: updated?.commit ? { sha:updated.commit.sha, message:updated.commit.message } : undefined, verified:true };
        break;
      }
      case 'push_project_archive': {
        const project = args.projectId ? db.getProjectById(args.projectId) : undefined;
        const archivePath = args.archivePath || project?.archivePath;
        const accountId = args.accountId || project?.githubAccountId;
        const owner = args.owner || project?.repoOwner;
        const repo = args.repo || project?.repoName;
        if (!archivePath || !accountId || !owner || !repo) throw new Error('archivePath, GitHub account, repository owner and repository are required.');
        const conn = db.getConnectionById(accountId);
        if (!conn) throw new Error('GitHub connection not found.');
        if (!connectionAllowed(gatewayKey, conn)) throw new Error('Gateway key is not authorized for this GitHub account.');
        if (!fs.existsSync(archivePath)) throw new Error('Project archive is no longer available. Upload the ZIP again.');
        if (conn.username && owner !== conn.username) throw new Error(`Repository owner ${owner} does not match connected GitHub identity ${conn.username}.`);
        const push = await pushProjectArchiveToGitHub(archivePath, accountId, owner, repo, args.branch || project?.branch || 'main');
        result = { accountId, repository: `${owner}/${repo}`, ...push };
        break;
      }
      case 'create_render_service': {
        const conn = db.getConnectionById(args.accountId) || findRender(args.message || '', gatewayKey);
        if (!connectionAllowed(gatewayKey, conn)) throw new Error('Gateway key is not authorized for this Render connection.');
        const secret = decryptSecret(db.getEncryptedSecret(conn.id) || '');
        const adapter = getProviderAdapter('render');
        if (!args.name || !args.repo) throw new Error('Render service name and repository URL are required.');
        const plan = args.plan || 'free';
        const cost = evaluateCostPolicy('render', 'create_service', { plan, humanApprovedPayment: args.humanApprovedPayment === true });
        if (!cost.allowed) throw new Error(cost.reason || 'Render service creation blocked by cost policy.');
        const ownerId = resolveRenderOwnerId(conn, args.ownerId || args.workspaceId || undefined);
        const created = await adapter.performAction(secret, 'create_service', {
          name: args.name,
          ownerId,
          repo: args.repo,
          branch: args.branch || 'main',
          serviceType: args.serviceType || 'web_service',
          buildCommand: args.buildCommand,
          startCommand: args.startCommand,
          publishPath: args.publishPath,
          dockerfilePath: args.dockerfilePath,
          dockerContext: args.dockerContext,
          dockerCommand: args.dockerCommand,
          plan,
        });
        const service = created?.service || created;
        if (!service?.id) throw new Error('Render returned a service creation response without a service ID.');
        const verified = await adapter.getResource(secret, 'service', String(service.id));
        const verifiedDetails = verified?.serviceDetails || verified?.service?.serviceDetails || {};
        result = { account: conn.accountName, workspaceId: ownerId, workspaceName: renderWorkspaceById(conn, ownerId)?.name, service: { id: verified?.id || service.id, name: verified?.name || service.name, repo: verified?.repo || service.repo, dashboardUrl: verified?.dashboardUrl || service.dashboardUrl, url: verifiedDetails?.url || verified?.url || undefined }, costPolicy: cost, verified: true };
        break;
      }

      case 'configure_render_service': {
        const conn = db.getConnectionById(args.accountId) || findRender(args.message || '', gatewayKey);
        if (!connectionAllowed(gatewayKey, conn)) throw new Error('Gateway key is not authorized for this Render connection.');
        const secret = decryptSecret(db.getEncryptedSecret(conn.id) || '');
        const serviceId = String(args.serviceId || '');
        if (!serviceId) throw new Error('Render serviceId is required.');
        const adapter = getProviderAdapter('render');
        const before = await adapter.getResource(secret, 'service', serviceId);
        const ownerId = before?.ownerId || before?.owner_id || before?.owner?.id || before?.service?.ownerId || before?.service?.owner_id;
        if (!ownerId || !renderWorkspaceOwns(conn, String(ownerId))) throw new Error('Render service belongs to a workspace that is not available through the selected Render API key.');
        const updated = await adapter.performAction(secret, 'update_service', { serviceId, branch: args.branch, repo: args.repo, buildCommand: args.buildCommand, startCommand: args.startCommand, autoDeploy: args.autoDeploy });
        const after = await adapter.getResource(secret, 'service', serviceId);
        result = { account: conn.accountName, service: after || updated, verified: true };
        break;
      }
      case 'list_render_env': {
        const conn = db.getConnectionById(args.accountId) || findRender(args.message || '', gatewayKey);
        if (!connectionAllowed(gatewayKey, conn)) throw new Error('Gateway key is not authorized for this Render connection.');
        const secret = decryptSecret(db.getEncryptedSecret(conn.id) || '');
        const adapter = getProviderAdapter('render');
        await assertRenderServiceAuthorized(conn, String(args.serviceId || ''), adapter, secret);
        result = { serviceId: args.serviceId, variables: await adapter.listResources(secret, 'env_vars', { serviceId: args.serviceId }) };
        break;
      }
      case 'set_render_env': {
        const conn = db.getConnectionById(args.accountId) || findRender(args.message || '', gatewayKey);
        if (!connectionAllowed(gatewayKey, conn)) throw new Error('Gateway key is not authorized for this Render connection.');
        const secret = decryptSecret(db.getEncryptedSecret(conn.id) || '');
        const adapter = getProviderAdapter('render');
        await assertRenderServiceAuthorized(conn, String(args.serviceId || ''), adapter, secret);
        result = await adapter.performAction(secret, 'set_env_var', { serviceId: args.serviceId, key: args.key, value: args.value });
        break;
      }
      case 'delete_render_env': {
        if (!args.confirmed) throw new Error('Confirmation is required before deleting a Render environment variable.');
        const conn = db.getConnectionById(args.accountId) || findRender(args.message || '', gatewayKey);
        if (!connectionAllowed(gatewayKey, conn)) throw new Error('Gateway key is not authorized for this Render connection.');
        const secret = decryptSecret(db.getEncryptedSecret(conn.id) || '');
        const adapter = getProviderAdapter('render');
        await assertRenderServiceAuthorized(conn, String(args.serviceId || ''), adapter, secret);
        result = await adapter.performAction(secret, 'delete_env_var', { serviceId: args.serviceId, key: args.key });
        break;
      }
      case 'list_render_domains': {
        const conn = db.getConnectionById(args.accountId) || findRender(args.message || '', gatewayKey);
        if (!connectionAllowed(gatewayKey, conn)) throw new Error('Gateway key is not authorized for this Render connection.');
        const secret = decryptSecret(db.getEncryptedSecret(conn.id) || '');
        const adapter = getProviderAdapter('render');
        await assertRenderServiceAuthorized(conn, String(args.serviceId || ''), adapter, secret);
        result = { serviceId: args.serviceId, domains: await adapter.listResources(secret, 'custom_domains', { serviceId: args.serviceId }) };
        break;
      }
      case 'add_render_domain': {
        const conn = db.getConnectionById(args.accountId) || findRender(args.message || '', gatewayKey);
        if (!connectionAllowed(gatewayKey, conn)) throw new Error('Gateway key is not authorized for this Render connection.');
        const secret = decryptSecret(db.getEncryptedSecret(conn.id) || '');
        const adapter = getProviderAdapter('render');
        await assertRenderServiceAuthorized(conn, String(args.serviceId || ''), adapter, secret);
        result = await adapter.performAction(secret, 'add_custom_domain', { serviceId: args.serviceId, name: args.domain });
        break;
      }
      case 'verify_render_domain': {
        const conn = db.getConnectionById(args.accountId) || findRender(args.message || '', gatewayKey);
        if (!connectionAllowed(gatewayKey, conn)) throw new Error('Gateway key is not authorized for this Render connection.');
        const secret = decryptSecret(db.getEncryptedSecret(conn.id) || '');
        const adapter = getProviderAdapter('render');
        await assertRenderServiceAuthorized(conn, String(args.serviceId || ''), adapter, secret);
        result = await adapter.performAction(secret, 'verify_custom_domain', { serviceId: args.serviceId, domain: args.domain });
        break;
      }
      case 'delete_render_domain': {
        if (!args.confirmed) throw new Error('Confirmation is required before deleting a custom domain.');
        const conn = db.getConnectionById(args.accountId) || findRender(args.message || '', gatewayKey);
        if (!connectionAllowed(gatewayKey, conn)) throw new Error('Gateway key is not authorized for this Render connection.');
        const secret = decryptSecret(db.getEncryptedSecret(conn.id) || '');
        const adapter = getProviderAdapter('render');
        await assertRenderServiceAuthorized(conn, String(args.serviceId || ''), adapter, secret);
        await adapter.getResource(secret, 'custom_domain', `${args.serviceId}|${args.domain}`);
        result = await adapter.performAction(secret, 'delete_custom_domain', { serviceId: args.serviceId, domain: args.domain, confirmed: true });
        break;
      }
      case 'list_render_services': {
        const conns = db.getConnections('render').filter((c) => connectionAllowed(gatewayKey, c));
        const services: any[] = [];
        for (const conn of conns) {
          const secret = decryptSecret(db.getEncryptedSecret(conn.id) || '');
          const list = await getProviderAdapter('render').listResources(secret, 'services', {});
          for (const service of list) { const workspace = renderWorkspaceById(conn, service.ownerId); services.push({ ...service, accountId: conn.id, accountName: conn.accountName, workspaceId: workspace?.id || service.ownerId, workspaceName: workspace?.name }); }
        }
        result = { services };
        break;
      }
      case 'deploy_render_service': {
        const conn = db.getConnectionById(args.accountId) || findRender(args.message || '', gatewayKey);
        if (!connectionAllowed(gatewayKey, conn)) throw new Error('Gateway key is not authorized for this Render connection.');
        if (!args.serviceId) throw new Error('Render serviceId is required.');
        const secret = decryptSecret(db.getEncryptedSecret(conn.id) || '');
        const adapter = getProviderAdapter('render');
        const service = await adapter.getResource(secret, 'service', args.serviceId);
        const ownerId = service?.ownerId || service?.owner_id || service?.owner?.id || service?.service?.ownerId || service?.service?.owner_id;
        if (!ownerId || !renderWorkspaceOwns(conn, String(ownerId))) throw new Error('Render service belongs to a workspace that is not available through the selected Render API key.');
        const serviceDetails = service?.serviceDetails || service?.service?.serviceDetails || {};
        const cost = evaluateCostPolicy('render', 'deploy', { plan: serviceDetails.plan || serviceDetails.buildPlan || args.plan || 'free' });
        if (!cost.allowed) throw new Error(cost.reason || 'Deployment blocked by cost policy.');
        const deploy = await adapter.performAction(secret, 'trigger_deploy', { serviceId: args.serviceId, clearCache: !!args.clearCache });
        result = { serviceId: args.serviceId, deploymentId: deploy?.id, status: deploy?.status || 'created', url: serviceDetails.url || service?.url, costPolicy: cost };
        break;
      }
      case 'restart_render_service': {
        const conn = db.getConnectionById(args.accountId) || findRender(args.message || '', gatewayKey);
        if (!connectionAllowed(gatewayKey, conn)) throw new Error('Gateway key is not authorized for this Render connection.');
        const secret = decryptSecret(db.getEncryptedSecret(conn.id) || '');
        const serviceId = String(args.serviceId || '');
        if (!serviceId) throw new Error('Render service ID is required.');
        const adapter = getProviderAdapter('render');
        await assertRenderServiceAuthorized(conn, serviceId, adapter, secret);
        const r = await adapter.performAction(secret, 'restart_service', { serviceId });
        result = { account: conn.accountName, serviceId, restarted: true, response: r };
        break;
      }
      case 'delete_render_service': {
        if (!args.confirmed) throw new Error('Confirmation is required before deleting a Render service.');
        const conn = db.getConnectionById(args.accountId) || findRender(args.message || '', gatewayKey);
        if (!connectionAllowed(gatewayKey, conn)) throw new Error('Gateway key is not authorized for this Render connection.');
        const secret = decryptSecret(db.getEncryptedSecret(conn.id) || '');
        const serviceId = String(args.serviceId || '');
        if (!serviceId) throw new Error('Render service ID is required.');
        const adapter = getProviderAdapter('render');
        await assertRenderServiceAuthorized(conn, serviceId, adapter, secret);
        const r = await adapter.performAction(secret, 'delete_service', { serviceId, confirmed: true });
        try {
          await adapter.getResource(secret, 'service', serviceId);
          throw new Error('Render did not confirm service removal yet.');
        } catch (verifyErr: any) {
          if (!String(verifyErr.message || '').includes('not found')) throw verifyErr;
        }
        result = { account: conn.accountName, serviceId, deleted: true, verified: true, response: r };
        break;
      }

      case 'rollback_render_deployment': {
        if (!args.confirmed) throw new Error('Confirmation is required before rollback.');
        const conn = db.getConnectionById(args.accountId) || findRender(args.message || '', gatewayKey);
        if (!connectionAllowed(gatewayKey, conn)) throw new Error('Gateway key is not authorized for this Render connection.');
        const secret = decryptSecret(db.getEncryptedSecret(conn.id) || '');
        const adapter = getProviderAdapter('render');
        const serviceId = args.serviceId;
        if (!serviceId) throw new Error('Render serviceId is required.');
        await assertRenderServiceAuthorized(conn, String(serviceId), adapter, secret);
        let targetDeployId = args.deployId;
        if (!targetDeployId) {
          const deploys = await adapter.listResources(secret, 'deployments', { serviceId });
          const candidates = deploys.filter((d: any) => ['live', 'deactivated'].includes(d.status)).sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          targetDeployId = candidates[1]?.id;
        }
        if (!targetDeployId) throw new Error('No previous deployment was found for rollback.');
        const rollback = await adapter.performAction(secret, 'rollback_deploy', { serviceId, deployId: targetDeployId });
        result = { serviceId, targetDeployId, deploymentId: rollback?.id, status: rollback?.status, trigger: rollback?.trigger };
        break;
      }
      case 'get_render_logs': {
        const conn = db.getConnectionById(args.accountId) || findRender(args.message || '', gatewayKey);
        if (!connectionAllowed(gatewayKey, conn)) throw new Error('Gateway key is not authorized for this Render connection.');
        const secret = decryptSecret(db.getEncryptedSecret(conn.id) || '');
        const adapter = getProviderAdapter('render');
        const service = await assertRenderServiceAuthorized(conn, String(args.serviceId || ''), adapter, secret);
        const ownerId = service?.ownerId || service?.owner_id || service?.owner?.id || service?.service?.ownerId || service?.service?.owner_id;
        result = await adapter.performAction(secret, 'get_logs', { serviceId: args.serviceId, ownerId: String(ownerId), startTime: args.startTime, endTime: args.endTime, limit: args.limit || 100 });
        break;
      }
      case 'check_relationship': {
        const gh = db.getConnectionById(String(args.githubAccountId || ''));
        const render = db.getConnectionById(String(args.renderWorkspaceId || ''));
        if (!gh || gh.provider !== 'github') throw new Error('Authorized GitHub connection is required.');
        if (!render || render.provider !== 'render') throw new Error('Authorized Render connection is required.');
        if (!connectionAllowed(gatewayKey, gh) || !connectionAllowed(gatewayKey, render)) throw new Error('Gateway key is not authorized for the requested provider connections.');
        result = await verifyGitHubRenderRelationship(gh.id, args.repoOwner, args.repoName, render.id, args.renderServiceId, args.renderWorkspaceOwnerId);
        break;
      }
      case 'list_gateway_activity': {
        if (!gatewayKey) { result = { logs: db.getActivityLogs({ limit: 100 }) }; break; }
        result = { logs: db.getActivityLogs({ gatewayKeyId: gatewayKey.id, limit: 100 }) };
        break;
      }
      case 'browser_back':
      case 'browser_forward':
      case 'browser_refresh':
      case 'browser_open_tab':
      case 'browser_switch_tab':
      case 'browser_close_tab': {
        if (!args.sessionId) throw new Error('Browser sessionId is required.');
        if (!browserAllowed(gatewayKey, args.sessionId)) throw new Error('Gateway key is not authorized for this browser session.');
        const actionMap:any = { browser_back:'back', browser_forward:'forward', browser_refresh:'refresh', browser_open_tab:'open_tab', browser_switch_tab:'switch_tab', browser_close_tab:'close_tab' };
        result = await browserManager.executeAction({ sessionId: args.sessionId, action: actionMap[toolName], params: args, gatewayKeyId: gatewayKey?.id });
        break;
      }
      case 'browser_click':
      case 'browser_type':
      case 'browser_copy':
      case 'browser_paste':
      case 'browser_scroll':
      case 'browser_tabs':
      case 'browser_screenshot':
      case 'browser_read_page': {
        if (!args.sessionId) throw new Error('Browser sessionId is required.');
        if (!browserAllowed(gatewayKey, args.sessionId)) throw new Error('Gateway key is not authorized for this browser session.');
        const actionMap: Record<string, string> = {
          browser_click: 'click', browser_type: 'type', browser_copy: 'copy', browser_paste: 'paste',
          browser_scroll: 'scroll', browser_tabs: 'tabs', browser_screenshot: 'screenshot', browser_read_page: 'read_page',
        };
        const action = actionMap[toolName];
        result = await browserManager.executeAction({ sessionId: args.sessionId, action: action as any, params: args, gatewayKeyId: gatewayKey?.id });
        break;
      }
      case 'browser_navigate': {
        if (!args.sessionId) throw new Error('Browser sessionId is required.');
        if (!browserAllowed(gatewayKey, args.sessionId)) throw new Error('Gateway key is not authorized for this browser session.');
        result = await browserManager.executeAction({ sessionId: args.sessionId, action: 'navigate', params: { url: args.url }, gatewayKeyId: gatewayKey?.id });
        break;
      }
      case 'browser_handoff': {
        if (!args.sessionId) throw new Error('Browser sessionId is required.');
        if (!browserAllowed(gatewayKey, args.sessionId)) throw new Error('Gateway key is not authorized for this browser session.');
        result = await browserManager.executeAction({ sessionId: args.sessionId, action: 'human_handoff', params: { reason: args.reason }, gatewayKeyId: gatewayKey?.id });
        break;
      }
      case 'check_free_option': {
        const resultCheck = evaluateCostPolicy(args.provider || 'generic', args.operation || 'deploy', args.params || {});
        result = resultCheck;
        break;
      }
      case 'analyze_project': {
        const project = db.getProjectById(args.projectId);
        if (!project) throw new Error('Project not found.');
        result = { project };
        break;
      }
      case 'system_audit': {
        result = {
          agent: ControlOrchestrator,
          vaultConfigured: !!process.env.ENCRYPTION_MASTER_KEY,
          sessionSecretConfigured: !!process.env.SESSION_SECRET,
          gatewaySigningSecretConfigured: !!process.env.GATEWAY_SIGNING_SECRET,
          browserAgentSecretConfigured: Boolean(process.env.BROWSER_AGENT_SHARED_SECRET),
          database: 'PostgreSQL runtime (DATABASE_URL)',
          aiBrain: { status: 'not_configured', mode: 'user-owned/self-hosted', externalAiDependency: false },
          connectedProviders: db.getConnections().filter((c) => connectionAllowed(gatewayKey, c)).map((c) => ({ id: c.id, provider: c.provider, accountName: c.accountName, status: c.status })),
        };
        break;
      }
      default:
        throw new Error(`Unknown agent operation: ${toolName}`);
    }

    const activityContext = activityAccountForTool(toolName, args);
    db.addActivityLog({
      id: `log_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
      timestamp: new Date().toISOString(), requestId, actor,
      agentId: gatewayKey?.id || ControlOrchestrator.id, gatewayKeyId: gatewayKey?.id,
      provider: activityContext.provider, account: activityContext.account,
      operation: toolName, target: args.target || args.repo || args.serviceId,
      capability: requiredCapabilityForTool[toolName], status: 'success', durationMs: Date.now() - started,
    });
    if (lockKey) taskEngine.releaseLock(lockKey);
    return redactSecrets(result);
  } catch (err: any) {
    const safe = redactSecrets(String(err.message || err));
    const activityContext = activityAccountForTool(toolName, args);
    db.addActivityLog({
      id: `log_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
      timestamp: new Date().toISOString(), requestId, actor,
      agentId: gatewayKey?.id || ControlOrchestrator.id, gatewayKeyId: gatewayKey?.id,
      provider: activityContext.provider, account: activityContext.account,
      operation: toolName, target: args.target || args.repo || args.serviceId,
      capability: requiredCapabilityForTool[toolName], status: 'failed', durationMs: Date.now() - started,
      errorCategory: 'AGENT_ERROR', safeErrorMessage: typeof safe === 'string' ? safe : JSON.stringify(safe),
    });
    if (lockKey) taskEngine.releaseLock(lockKey);
    throw err;
  }
}

async function monitorRenderDeployment(deployment: any, conn: ProviderConnection, serviceId: string) {
  const started = Date.now();
  const secret = decryptSecret(db.getEncryptedSecret(conn.id) || '');
  const adapter = getProviderAdapter('render');
  const deadline = Date.now() + 15 * 60 * 1000;
  let lastLogsAt = 0;

  while (Date.now() < deadline) {
    try {
      const current = await adapter.getResource(secret, 'deployment', `${serviceId}/${deployment.deploymentId}`).catch(() => null);
      const status = current?.status || current?.deploy?.status;
      const logsNow = Date.now();
      if (logsNow - lastLogsAt > 10000) {
        lastLogsAt = logsNow;
        const ownerId = resolveRenderOwnerId(conn, deployment.renderWorkspaceOwnerId || undefined);
        if (ownerId) {
          const logResult = await adapter.performAction(secret, 'get_logs', { serviceId, ownerId, limit: 100 }).catch(() => ({ logs: [] }));
          if (Array.isArray(logResult?.logs)) deployment.buildLogs = logResult.logs.slice(-300);
        }
      }

      if (status === 'live') {
        const liveService = await adapter.getResource(secret, 'service', serviceId).catch(() => null);
        const liveDetails = liveService?.serviceDetails || liveService?.service?.serviceDetails || {};
        if (liveDetails?.url || liveService?.url) deployment.url = liveDetails?.url || liveService?.url;
        deployment.status = 'live';
        deployment.durationMs = Date.now() - started;
        deployment.updatedAt = new Date().toISOString();
        db.saveDeployment(deployment);
        const project = db.getProjectById(deployment.projectId);
        if (project) { project.status = 'active'; project.updatedAt = new Date().toISOString(); db.saveProject(project); }
        return deployment;
      }
      if (['build_failed', 'update_failed', 'canceled', 'pre_deploy_failed'].includes(String(status))) {
        deployment.status = status === 'canceled' ? 'cancelled' : 'failed';
        deployment.durationMs = Date.now() - started;
        deployment.errorDiagnosis = classifyDeploymentLogs(deployment.buildLogs || []);
        deployment.updatedAt = new Date().toISOString();
        db.saveDeployment(deployment);
        const project = db.getProjectById(deployment.projectId);
        if (project) { project.status = 'failed'; project.updatedAt = new Date().toISOString(); db.saveProject(project); }
        return deployment;
      }
      deployment.status = 'building';
      deployment.updatedAt = new Date().toISOString();
      db.saveDeployment(deployment);
    } catch (err: any) {
      deployment.updatedAt = new Date().toISOString();
      db.saveDeployment(deployment);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  deployment.status = 'building';
  deployment.durationMs = Date.now() - started;
  deployment.errorDiagnosis = {
    category: 'MONITOR_TIMEOUT',
    whatHappened: 'Render did not reach a terminal state within the monitoring window.',
    whyItHappened: 'The deployment may still be running or the provider did not expose a terminal status before monitoring stopped.',
    evidence: `Monitored for ${Math.round((Date.now() - started) / 1000)} seconds without a terminal provider state.`,
    suggestedFix: 'Check the latest Render deployment status/logs; do not start a duplicate deployment while this one may still be active.',
    riskLevel: 'medium',
  };
  deployment.updatedAt = new Date().toISOString();
  db.saveDeployment(deployment);
  return deployment;
}

async function deployProjectFromRequest(message: string, key?: GatewayKey) {
  const projects = db.getProjects();
  const matches = projects.filter((p) => message.toLowerCase().includes(p.name.toLowerCase()));
  const project = matches.length === 1 ? matches[0] : (matches.length === 0 && projects.length === 1 ? projects[0] : undefined);
  if (!project) return { text: matches.length > 1 ? `I found multiple saved projects (${matches.map((p) => p.name).join(', ')}). Tell me the exact project name so I do not guess.` : 'I need a registered project before I can deploy it. Upload the project ZIP first, or tell me which saved project to use.', executedTools: [] };
  if (!project.githubAccountId) return { text: `Project "${project.name}" has no GitHub account selected yet.`, executedTools: [] };
  if (!project.renderWorkspaceId) return { text: `Project "${project.name}" has no Render workspace selected yet.`, executedTools: [] };
  if (key && (!connectionAllowed(key, db.getConnectionById(project.githubAccountId)!) || !connectionAllowed(key, db.getConnectionById(project.renderWorkspaceId)!))) throw new Error('Gateway key is not authorized for the project accounts.');

  const gh = db.getConnectionById(project.githubAccountId);
  const render = db.getConnectionById(project.renderWorkspaceId);
  if (!gh || !render) throw new Error('Project provider connection is missing.');

  const tools: any[] = [];
  if (project.repoOwner && project.repoName) {
    const relation = await executeToolCall('check_relationship', { githubAccountId: gh.id, repoOwner: project.repoOwner, repoName: project.repoName, renderWorkspaceId: render.id, renderServiceId: project.renderServiceId, renderWorkspaceOwnerId: project.renderWorkspaceOwnerId }, key ? key.keyName : 'Main AI', key);
    tools.push({ name: 'check_relationship', args: {}, result: relation });
    if (!relation.valid) return { text: relation.reason || 'Repository relationship could not be verified.', executedTools: tools };
  }

  let repoOwner = project.repoOwner || gh.username;
  let repoName = project.repoName;
  if (!repoName) {
    const safeName = project.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || `project-${Date.now()}`;
    const created = await executeToolCall('create_repository', { accountId: gh.id, name: safeName, isPrivate: true, autoInit: true }, key ? key.keyName : 'Main AI', key);
    tools.push({ name: 'create_repository', args: { accountId: gh.id, name: safeName }, result: created });
    repoName = created.repository.name;
    repoOwner = gh.username || repoOwner;
  }

  if (project.archivePath && fs.existsSync(project.archivePath)) {
    const pushResult = await executeToolCall('push_project_archive', { projectId: project.id, accountId: gh.id, owner: repoOwner || gh.username || '', repo: repoName, archivePath: project.archivePath, branch: project.branch || 'main' }, key ? key.keyName : 'Main AI', key);
    tools.push({ name: 'push_project_archive', args: { repoName }, result: pushResult });
  }

  project.repoOwner = repoOwner;
  project.repoName = repoName;
  project.githubAccountId = gh.id;
  project.renderWorkspaceId = render.id;
  project.renderWorkspaceOwnerId = resolveRenderOwnerId(render, project.renderWorkspaceOwnerId);
  project.renderWorkspaceName = renderWorkspaceById(render, project.renderWorkspaceOwnerId)?.name;
  project.updatedAt = new Date().toISOString();
  db.saveProject(project);

  if (!project.renderServiceId) {
    const serviceType = project.projectType === 'static' ? 'static_site' : 'web_service';
    const runtime = project.projectType === 'docker' ? 'docker' : 'node';
    const renderOwnerId = resolveRenderOwnerId(render, project.renderWorkspaceOwnerId);
    project.renderWorkspaceOwnerId = renderOwnerId;
    project.renderWorkspaceName = renderWorkspaceById(render, renderOwnerId)?.name;
    const createdResult = await executeToolCall('create_render_service', { accountId: render.id, name: project.name, ownerId: renderOwnerId, repo: `https://github.com/${repoOwner}/${repoName}`, branch: project.branch || 'main', buildCommand: project.buildCommand, startCommand: project.startCommand, serviceType, env: runtime, publishPath: project.projectType === 'static' ? 'dist' : undefined }, key ? key.keyName : 'Main AI', key);
    const service = createdResult.service || {};
    project.renderServiceId = service.id;
    project.renderServiceName = service.name || project.name;
    db.saveProject(project);
    tools.push({ name: 'create_render_service', args: { workspaceId: render.id, name: project.name }, result: createdResult });
  }

  if (!project.renderServiceId) throw new Error('Render service creation did not return a service ID.');
  const dep = await executeToolCall('deploy_render_service', { accountId: render.id, serviceId: project.renderServiceId }, key ? key.keyName : 'Main AI', key);
  tools.push({ name: 'deploy_render_service', args: { serviceId: project.renderServiceId }, result: dep });

  const deploymentId = dep.deploymentId;
  if (deploymentId) {
    const record = db.saveDeployment({
      id: `dep_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      projectId: project.id,
      projectName: project.name,
      provider: 'render',
      accountId: render.id,
      renderWorkspaceOwnerId: project.renderWorkspaceOwnerId,
      serviceId: project.renderServiceId,
      deploymentId,
      status: 'queued',
      buildLogs: [],
      url: dep.url,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    project.status = 'deploying';
    project.lastDeploymentAt = new Date().toISOString();
    db.saveProject(project);
    void monitorRenderDeployment(record, render, project.renderServiceId);
  }

  return { text: `Deployment started for ${project.name}. GitHub: ${repoOwner}/${repoName}. Render deployment: ${deploymentId || 'submitted'}. I am monitoring the real provider state.`, executedTools: tools };
}

export interface OwnedAIBrainRequest {
  message: string;
  history: any[];
  gatewayKey?: GatewayKey;
}

/**
 * The main chat brain is intentionally not coupled to Gemini, OpenAI, Grok, or any
 * other hosted AI. The future implementation is supplied by the workspace owner.
 * Until that brain exists, the application never pretends that deterministic
 * keyword parsing is a real AI model. Gateway/tool operations remain available.
 */
export async function processAgentMessage(message: string, history: any[] = [], gatewayKey?: GatewayKey) {
  const clean = message.trim();
  const plan = ['Receive request', 'Pass request to the user-owned AI brain', 'Apply capability and account checks', 'Execute real tools', 'Verify and report'];
  if (!clean) return { text: 'Message is empty.', plan, executedTools: [] };

  return {
    text: 'Your AI Control Center is ready for the control/tools layer, but the user-owned AI brain is not installed yet. No external AI API is configured or used. Build/connect your own local AI brain to this chat boundary before expecting natural-language reasoning.',
    plan,
    executedTools: [],
  };
}
