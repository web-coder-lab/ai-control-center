import { Router, type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import { db } from '../database/db.js';
import { hashGatewayKey, redactSecrets, encryptSecret, decryptSecret, createTokenFingerprint } from '../security/vault.js';
import { SYSTEM_CAPABILITIES } from '../../shared/capabilities.js';
import { renderWorkspaceById, renderWorkspaceOwns, resolveRenderWorkspace } from '../providers/render/workspace.js';
import { executeToolCall, processAgentMessage } from '../ai/agent.service.js';
import { getProviderAdapter } from '../providers/index.js';
import { taskEngine } from '../tasks/task.engine.js';
import type { GatewayKey } from '../../shared/types.js';

export const gatewayRouter = Router();

// In-memory rate limiting map for gateway keys
const rateLimits = new Map<string, { count: number; windowStart: number }>();
export function getRateSnapshot(keyId: string, limit: number) {
  const now = Date.now();
  const rl = rateLimits.get(keyId);
  if (!rl || now - rl.windowStart > 60000) return { used: 0, remaining: limit, resetMs: 60000 };
  return { used: rl.count, remaining: Math.max(0, limit - rl.count), resetMs: Math.max(0, 60000 - (now - rl.windowStart)) };
}


/**
 * Gateway Authentication & Live Permission Check Middleware
 */
async function authenticateGateway(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      code: 'AUTH_REQUIRED',
      message: 'Missing or malformed Authorization header. Provide Bearer gw_xxxxxxxx',
    });
  }

  const rawKey = authHeader.slice(7).trim();
  const keyHash = hashGatewayKey(rawKey);
  const key = db.findGatewayKeyByHash(keyHash);

  if (!key) {
    db.addSecurityEvent({
      id: `sec_${Date.now()}`,
      timestamp: new Date().toISOString(),
      eventType: 'INVALID_GATEWAY_KEY_ATTEMPT',
      actor: 'Unknown External AI',
      severity: 'high',
      details: 'Failed authentication attempt with nonexistent Gateway key hash.',
      resolved: true,
    });

    return res.status(401).json({
      success: false,
      code: 'INVALID_KEY',
      message: 'Gateway API Key is invalid or does not exist.',
    });
  }

  // Check key status
  if (key.status === 'revoked') {
    return res.status(403).json({
      success: false,
      code: 'KEY_REVOKED',
      message: 'This Gateway API Key has been permanently revoked.',
    });
  }

  if (key.status === 'disabled') {
    return res.status(403).json({
      success: false,
      code: 'KEY_DISABLED',
      message: 'This Gateway API Key is temporarily disabled by workspace owner.',
    });
  }

  if (key.expiresAt && new Date(key.expiresAt).getTime() < Date.now()) {
    key.status = 'expired';
    db.saveGatewayKey(key);
    return res.status(403).json({
      success: false,
      code: 'KEY_EXPIRED',
      message: 'This Gateway API Key has expired.',
    });
  }

  // Enforce Rate Limit per Gateway Key
  const now = Date.now();
  const rl = rateLimits.get(key.id) || { count: 0, windowStart: now };
  if (now - rl.windowStart > 60000) {
    rl.count = 1;
    rl.windowStart = now;
  } else {
    rl.count++;
  }
  rateLimits.set(key.id, rl);

  if (rl.count > (key.rateLimit || 60)) {
    db.addActivityLog({
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      requestId: `req_gw_rl_${Date.now()}`,
      actor: key.keyName,
      agentId: key.id,
      gatewayKeyId: key.id,
      operation: `GATEWAY ${req.method} ${req.path}`,
      status: 'blocked',
      durationMs: 0,
      errorCategory: 'RATE_LIMIT_EXCEEDED',
      safeErrorMessage: `Gateway rate limit of ${key.rateLimit || 60} requests/minute exceeded.`,
    });
    return res.status(429).json({
      success: false,
      code: 'RATE_LIMIT_EXCEEDED',
      message: `Rate limit of ${key.rateLimit} requests/min exceeded. Please throttle requests.`,
    });
  }

  // Safe first-use handshake: capability discovery is allowed first, then the external client
  // must explicitly acknowledge the access manifest before invoking operational routes.
  const handshakePath = req.path === '/handshake' || req.path === '/capabilities';
  if (!key.handshakeAcceptedAt && !handshakePath) {
    return res.status(428).json({
      success: false,
      code: 'HANDSHAKE_REQUIRED',
      message: 'First-use access handshake required. Call GET /v1/capabilities, review the manifest, then POST /v1/handshake.',
      permissionVersion: key.permissionVersion,
    });
  }

  // Update last used timestamp
  key.lastUsedAt = new Date().toISOString();
  db.saveGatewayKey(key);

  // Attach key to request context
  (req as any).gatewayKey = key;
  (req as any).requestId = `req_gw_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  next();
}

/**
 * Helper to check a specific capability for the current gateway key
 */
function requireCapability(capabilityId: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = (req as any).gatewayKey as GatewayKey;
    const allowed = key.capabilities?.[capabilityId] === true;

    if (!allowed) {
      db.addActivityLog({
        id: `log_${Date.now()}`,
        timestamp: new Date().toISOString(),
        requestId: (req as any).requestId,
        actor: key.keyName,
        agentId: key.id,
        gatewayKeyId: key.id,
        operation: req.path,
        capability: capabilityId,
        status: 'blocked',
        durationMs: 0,
        errorCategory: 'PERMISSION_DENIED',
        safeErrorMessage: `Capability "${capabilityId}" is not granted to this Gateway key.`,
      });

      return res.status(403).json({
        success: false,
        code: 'PERMISSION_DENIED',
        message: `Your Gateway Key does not have the required capability: "${capabilityId}". The workspace owner must grant this capability in the Access Center.`,
        requiredCapability: capabilityId,
        keyPermissionVersion: key.permissionVersion,
      });
    }

    next();
  };
}


function selectGatewayConnection(provider: string, requestedId: string | undefined, key: GatewayKey): any {
  const conns = db.getConnections(provider).filter((c) => {
    if (key.allowedProviders?.length && !key.allowedProviders.includes(c.provider)) return false;
    return !key.allowedAccounts?.length || key.allowedAccounts.includes(c.id) || key.allowedAccounts.includes(c.accountId || '');
  });
  if (requestedId) {
    const selected = db.getConnectionById(String(requestedId));
    if (!selected || !conns.some((c) => c.id === selected.id)) throw new Error(`The requested ${provider} connection is not authorized for this Gateway key.`);
    return selected;
  }
  if (conns.length === 1) return conns[0];
  if (conns.length === 0) throw new Error(`No authorized ${provider} connection is available.`);
  throw new Error(`Multiple ${provider} connections are authorized. Specify accountId explicitly.`);
}


const DOWNLOAD_HOSTS: Record<string, RegExp[]> = {
  github: [/^api\.github\.com$/i, /^raw\.githubusercontent\.com$/i],
  render: [/^api\.render\.com$/i],
  cloudflare: [/^api\.cloudflare\.com$/i],
  vercel: [/^api\.vercel\.com$/i],
  netlify: [/^api\.netlify\.com$/i],
  supabase: [/^[a-z0-9-]+\.supabase\.co$/i],
  digitalocean: [/^api\.digitalocean\.com$/i],
};

function downloadHostAllowed(provider: string, url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('Only HTTPS provider URLs may be streamed through the Gateway.');
  const rules = DOWNLOAD_HOSTS[provider] || [];
  if (!rules.some((rx) => rx.test(parsed.hostname))) throw new Error('This URL host is not approved for the selected provider connection.');
  return parsed;
}

gatewayRouter.use(authenticateGateway);

gatewayRouter.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    const key = (req as any).gatewayKey as GatewayKey | undefined;
    if (!key) return;
    db.addActivityLog({
      id: `log_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
      timestamp: new Date().toISOString(),
      requestId: (req as any).requestId || `req_gw_${Date.now()}`,
      actor: key.keyName,
      agentId: key.id,
      gatewayKeyId: key.id,
      operation: `GATEWAY ${req.method} ${req.path}`,
      status: res.statusCode >= 400 ? 'failed' : 'success',
      durationMs: Date.now() - started,
      errorCategory: res.statusCode >= 400 ? `HTTP_${res.statusCode}` : undefined,
      safeErrorMessage: res.statusCode >= 400 ? `Gateway request returned HTTP ${res.statusCode}.` : undefined,
    });
  });
  next();
});

gatewayRouter.post('/handshake', (req: Request, res: Response) => {
  const key = (req as any).gatewayKey as GatewayKey;
  key.handshakeAcceptedAt = new Date().toISOString();
  db.saveGatewayKey(key);
  db.addSecurityEvent({ id:`sec_${Date.now()}`, timestamp:new Date().toISOString(), eventType:'GATEWAY_HANDSHAKE_ACCEPTED', actor:key.keyName, severity:'low', details:`External AI ${key.keyName} accepted the Gateway access manifest.`, resolved:true });
  res.json({ success:true, message:'Gateway handshake accepted. Current capabilities can now be used according to the live permission record.', permissionVersion:key.permissionVersion, acceptedAt:key.handshakeAcceptedAt });
});


/**
 * GET /v1/capabilities
 * Safe Discovery Handshake (Requirement 57 & 183)
 * Returns capabilities, allowed accounts, allowed browser sessions - NEVER raw secrets.
 */
gatewayRouter.get('/capabilities', (req: Request, res: Response) => {
  const key = (req as any).gatewayKey as GatewayKey;
  const granted = Object.entries(key.capabilities || {})
    .filter(([_, isGranted]) => isGranted)
    .map(([cap]) => cap);

  const defs = SYSTEM_CAPABILITIES.filter((c) => granted.includes(c.id)).map((c) => ({
    id: c.id,
    name: c.name,
    group: c.group,
    description: c.description,
  }));

  const connections = db.getConnections().filter((c) => {
    const providerAllowed = !key.allowedProviders?.length || key.allowedProviders.includes(c.provider);
    const accountAllowed = !key.allowedAccounts?.length || key.allowedAccounts.includes(c.id) || key.allowedAccounts.includes(c.accountId || '');
    return providerAllowed && accountAllowed;
  }).map((c) => ({
    id: c.id, provider: c.provider, accountName: c.accountName, username: c.username,
    accountId: c.accountId, label: c.label, purpose: c.purpose, description: c.description,
    howToUse: c.howToUse, status: c.status, permissions: c.permissions,
  }));
  const browserSessions = db.getBrowserSessions().filter((s) => !key.allowedBrowserSessions?.length || key.allowedBrowserSessions.includes(s.id)).map((s) => ({
    id: s.id, sessionName: s.sessionName, profileName: s.profileName, providerAccountId: s.providerAccountId, status: s.status,
  }));
  res.json({
    success: true,
    agent: key.keyName,
    status: key.status,
    permissionVersion: key.permissionVersion,
    allowedProviders: key.allowedProviders,
    allowedAccounts: key.allowedAccounts,
    allowedBrowserSessions: key.allowedBrowserSessions,
    capabilities: defs,
    connections,
    browserSessions,
    restrictions: { browserDownload: false, browserUpload: false, browserCookies: false, browserPasswords: false, browserStorage: false, browserPermissions: false, payment: key.capabilities?.['payment'] === true },
  });
});

/**
 * GET /v1/activity
 * External AI Log Access (Requirement 40)
 * Only returns logs generated by this key.
 */
gatewayRouter.get('/activity', requireCapability('gateway.activity.read'), (req: Request, res: Response) => {
  const key = (req as any).gatewayKey as GatewayKey;
  const logs = db.getActivityLogs({ gatewayKeyId: key.id, limit: 100 });
  res.json({
    success: true,
    logs: redactSecrets(logs),
  });
});

/**
 * POST /v1/tasks
 * Submit compound asynchronous task
 */
gatewayRouter.post('/tasks', requireCapability('gateway.task.create'), async (req: Request, res: Response) => {
  const key = (req as any).gatewayKey as GatewayKey;
  const { request, plan } = req.body;

  if (!request) {
    return res.status(400).json({ success: false, message: 'Field "request" is required.' });
  }

  const requestedPlan = Array.isArray(plan) && plan.length > 0 ? plan.map(String).slice(0, 50) : ['Execute authorized agent request'];
  const task = taskEngine.createTask(key.keyName, request, requestedPlan, key.id);
  void (async () => {
    try {
      // The plan is descriptive; only execution itself is marked completed here.
      const executionStepIndex = 0;
      taskEngine.updateTaskStep(task.id, executionStepIndex, 'running', 'Executing the real request through the control orchestrator.');
      const result = await processAgentMessage(request, [], key);
      taskEngine.updateTaskStep(task.id, executionStepIndex, 'completed', 'Request execution completed; inspect linked activity logs for the actual provider actions.');
      taskEngine.completeTask(task.id, result);
    } catch (err: any) {
      taskEngine.failTask(task.id, String(err.message || err));
    }
  })();

  res.status(202).json({
    success: true,
    taskId: task.id,
    status: task.status,
    pollUrl: `/v1/tasks/${task.id}`,
  });
});

/**
 * GET /v1/tasks/:id
 */
gatewayRouter.get('/tasks/:id', requireCapability('gateway.task.read'), (req: Request, res: Response) => {
  const task = db.getTaskById(req.params.id);
  const key = (req as any).gatewayKey as GatewayKey;
  if (!task || (task.gatewayKeyId && task.gatewayKeyId !== key.id)) return res.status(404).json({ success: false, message: 'Task not found' });
  res.json({ success: true, task: redactSecrets(task) });
});

/**
 * GitHub account discovery
 */
gatewayRouter.get('/github/accounts', requireCapability('github.account.read'), async (req: Request, res: Response) => {
  const r = await executeToolCall('list_github_accounts', {}, (req as any).gatewayKey.keyName, (req as any).gatewayKey);
  res.json({ success: true, accounts: r.accounts });
});

/**
 * GitHub Endpoints
 */
gatewayRouter.get('/github/repos', requireCapability('github.repository.list'), async (req: Request, res: Response) => {
  try {
    const { accountId } = req.query;
    const target = selectGatewayConnection('github', accountId ? String(accountId) : undefined, (req as any).gatewayKey);

    const result = await executeToolCall('list_repositories', { accountId: target.id }, (req as any).gatewayKey.keyName, (req as any).gatewayKey);
    res.json({ success: true, repositories: result });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

gatewayRouter.post('/github/repos', requireCapability('github.repository.create'), async (req: Request, res: Response) => {
  try {
    const { accountId, name, description, isPrivate } = req.body;
    const target = selectGatewayConnection('github', accountId ? String(accountId) : undefined, (req as any).gatewayKey);

    const result = await executeToolCall('create_repository', {
      accountId: target.id,
      name,
      description,
      isPrivate,
    }, (req as any).gatewayKey.keyName, (req as any).gatewayKey);

    res.json({ success: true, repository: result });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

gatewayRouter.get('/github/files', requireCapability('github.file.read'), async (req: Request, res: Response) => {
  try {
    const { accountId, owner, repo, path: filePath } = req.query;
    if (!owner || !repo || !filePath) return res.status(400).json({ success:false, message:'owner, repo and path are required.' });
    const target = selectGatewayConnection('github', accountId ? String(accountId) : undefined, (req as any).gatewayKey);
    const result = await executeToolCall('read_file', { accountId:target.id, owner:String(owner), repo:String(repo), path:String(filePath) }, (req as any).gatewayKey.keyName, (req as any).gatewayKey);
    res.json({ success:true, ...result });
  } catch (err:any) { res.status(500).json({ success:false, message:redactSecrets(err.message || 'GitHub file read failed') }); }
});

gatewayRouter.put('/github/files', requireCapability('github.file.write'), async (req: Request, res: Response) => {
  try {
    const { accountId, owner, repo, path: filePath, content, contentBase64, message, branch, sha } = req.body || {};
    if (!owner || !repo || !filePath) return res.status(400).json({ success:false, message:'owner, repo and path are required.' });
    const target = selectGatewayConnection('github', accountId ? String(accountId) : undefined, (req as any).gatewayKey);
    const result = await executeToolCall('write_file', { accountId:target.id, owner:String(owner), repo:String(repo), path:String(filePath), content, contentBase64, message, branch, sha }, (req as any).gatewayKey.keyName, (req as any).gatewayKey);
    res.json({ success:true, ...result });
  } catch (err:any) { res.status(500).json({ success:false, message:redactSecrets(err.message || 'GitHub file write failed') }); }
});

gatewayRouter.delete('/github/repos/:owner/:repo', requireCapability('github.repository.delete'), async (req: Request, res: Response) => {
  try {
    const { owner, repo } = req.params;
    const { accountId, confirmed } = req.body;
    if (!confirmed) {
      return res.status(400).json({
        success: false,
        code: 'CONFIRMATION_REQUIRED',
        message: 'Repository deletion requires explicit confirmation parameter: { confirmed: true }.',
      });
    }

    const target = selectGatewayConnection('github', accountId ? String(accountId) : undefined, (req as any).gatewayKey);

    const result = await executeToolCall('delete_repository', {
      accountId: target.id,
      owner,
      repo,
      confirmed: true,
    }, (req as any).gatewayKey.keyName, (req as any).gatewayKey);

    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

gatewayRouter.get('/render/workspaces', requireCapability('render.workspace.read'), async (req: Request, res: Response) => {
  const key = (req as any).gatewayKey as GatewayKey;
  const connections = db.getConnections('render').filter((c) => !key.allowedAccounts?.length || key.allowedAccounts.includes(c.id) || key.allowedAccounts.includes(c.accountId || ''));
  const workspaces: any[] = [];
  for (const conn of connections) {
    const secret = decryptSecret(db.getEncryptedSecret(conn.id) || '');
    const list = await getProviderAdapter('render').listResources(secret, 'workspaces');
    for (const workspace of list) workspaces.push({ ...workspace, connectionId: conn.id, connectionName: conn.accountName });
  }
  res.json({ success:true, workspaces });
});

/**
 * Render Endpoints
 */

gatewayRouter.post('/render/services', requireCapability('render.service.create'), async (req: Request, res: Response) => {
  try {
    const { accountId, workspaceId, name, repo, branch, buildCommand, startCommand, serviceType, plan, ownerId } = req.body || {};
    if (!name || !repo) return res.status(400).json({ success:false, message:'name and repo are required.' });
    const target = selectGatewayConnection('render', accountId ? String(accountId) : undefined, (req as any).gatewayKey);
    const selectedOwnerId = resolveRenderWorkspace(target, ownerId || workspaceId).id;
    const result = await executeToolCall('create_render_service', { accountId:target.id, name, repo, branch, buildCommand, startCommand, serviceType, plan, ownerId:selectedOwnerId }, (req as any).gatewayKey.keyName, (req as any).gatewayKey);
    res.status(201).json({ success:true, service:result });
  } catch (err:any) { res.status(500).json({ success:false, message:redactSecrets(err.message || 'Render service creation failed') }); }
});

gatewayRouter.get('/render/logs', requireCapability('render.logs'), async (req: Request, res: Response) => {
  try {
    const result = await executeToolCall('get_render_logs', { accountId:req.query.accountId, serviceId:req.query.serviceId, startTime:req.query.startTime, endTime:req.query.endTime, limit:req.query.limit ? Number(req.query.limit) : 100 }, (req as any).gatewayKey.keyName, (req as any).gatewayKey);
    res.json({ success:true, ...result });
  } catch (err:any) { res.status(500).json({ success:false, message:redactSecrets(err.message || 'Render log retrieval failed') }); }
});

gatewayRouter.get('/render/services/:serviceId', requireCapability('render.service.read'), async (req: Request, res: Response) => {
  try {
    const key=(req as any).gatewayKey as GatewayKey;
    const target=selectGatewayConnection('render', req.query.accountId ? String(req.query.accountId) : undefined, key);
    const secret=decryptSecret(db.getEncryptedSecret(target.id) || '');
    const service=await getProviderAdapter('render').getResource(secret,'service',req.params.serviceId);
    const ownerId=service?.ownerId || service?.owner_id || service?.owner?.id || service?.service?.ownerId || service?.service?.owner_id;
    if (!ownerId || !renderWorkspaceOwns(target, String(ownerId))) throw new Error('Render service belongs to a workspace that is not available through the selected Render API key.');
    res.json({ success:true, service:{...service, accountId:target.id, accountName:target.accountName} });
  } catch(err:any){ res.status(500).json({success:false,message:redactSecrets(err.message || 'Render service lookup failed')}); }
});

gatewayRouter.patch('/render/services/:serviceId', requireCapability('render.service.configure'), async (req: Request, res: Response) => {
  try {
    const key = (req as any).gatewayKey as GatewayKey;
    const target = selectGatewayConnection('render', req.query.accountId ? String(req.query.accountId) : String(req.body?.accountId || ''), key);
    const result = await executeToolCall('configure_render_service', { accountId: target.id, serviceId: req.params.serviceId, branch: req.body?.branch, repo: req.body?.repo, buildCommand: req.body?.buildCommand, startCommand: req.body?.startCommand, autoDeploy: req.body?.autoDeploy }, key.keyName, key);
    res.json({ success: true, service: result });
  } catch (err: any) { res.status(500).json({ success:false, message:redactSecrets(err.message || 'Render service update failed') }); }
});

gatewayRouter.get('/render/services/:serviceId/env-vars', requireCapability('render.service.read'), async (req: Request, res: Response) => {
  try {
    const key = (req as any).gatewayKey as GatewayKey;
    const target = selectGatewayConnection('render', req.query.accountId ? String(req.query.accountId) : undefined, key);
    const result = await executeToolCall('list_render_env', { accountId: target.id, serviceId: req.params.serviceId }, key.keyName, key);
    res.json({ success:true, ...result });
  } catch (err:any) { res.status(500).json({success:false,message:redactSecrets(err.message || 'Render environment lookup failed')}); }
});

gatewayRouter.put('/render/services/:serviceId/env-vars/:key', requireCapability('render.service.configure'), async (req: Request, res: Response) => {
  try {
    const keyCtx = (req as any).gatewayKey as GatewayKey;
    if (typeof req.body?.value !== 'string') return res.status(400).json({success:false,message:'Environment variable value is required.'});
    const target = selectGatewayConnection('render', req.query.accountId ? String(req.query.accountId) : String(req.body?.accountId || ''), keyCtx);
    const result = await executeToolCall('set_render_env', { accountId: target.id, serviceId: req.params.serviceId, key: req.params.key, value: req.body.value }, keyCtx.keyName, keyCtx);
    res.json({success:true,result});
  } catch (err:any) { res.status(500).json({success:false,message:redactSecrets(err.message || 'Render environment update failed')}); }
});

gatewayRouter.delete('/render/services/:serviceId/env-vars/:key', requireCapability('render.service.configure'), async (req: Request, res: Response) => {
  try {
    const keyCtx = (req as any).gatewayKey as GatewayKey;
    if (req.body?.confirmed !== true) return res.status(400).json({success:false,code:'CONFIRMATION_REQUIRED',message:'Environment variable deletion requires confirmed:true.'});
    const target = selectGatewayConnection('render', req.query.accountId ? String(req.query.accountId) : String(req.body?.accountId || ''), keyCtx);
    const result = await executeToolCall('delete_render_env', { accountId: target.id, serviceId: req.params.serviceId, key: req.params.key, confirmed: true }, keyCtx.keyName, keyCtx);
    res.json({success:true,result});
  } catch (err:any) { res.status(500).json({success:false,message:redactSecrets(err.message || 'Render environment deletion failed')}); }
});

gatewayRouter.get('/render/services/:serviceId/domains', requireCapability('render.domain.read'), async (req: Request, res: Response) => {
  try {
    const keyCtx = (req as any).gatewayKey as GatewayKey;
    const target = selectGatewayConnection('render', req.query.accountId ? String(req.query.accountId) : undefined, keyCtx);
    const result = await executeToolCall('list_render_domains', { accountId: target.id, serviceId: req.params.serviceId }, keyCtx.keyName, keyCtx);
    res.json({success:true,...result});
  } catch (err:any) { res.status(500).json({success:false,message:redactSecrets(err.message || 'Render domain lookup failed')}); }
});

gatewayRouter.post('/render/services/:serviceId/domains', requireCapability('render.domain.write'), async (req: Request, res: Response) => {
  try {
    const keyCtx=(req as any).gatewayKey as GatewayKey;
    const domain=String(req.body?.domain || ''); if (!domain) return res.status(400).json({success:false,message:'domain is required'});
    const target=selectGatewayConnection('render', req.query.accountId ? String(req.query.accountId) : String(req.body?.accountId || ''), keyCtx);
    const result=await executeToolCall('add_render_domain',{accountId:target.id,serviceId:req.params.serviceId,domain},keyCtx.keyName,keyCtx);
    res.status(201).json({success:true,result});
  } catch(err:any){ res.status(500).json({success:false,message:redactSecrets(err.message || 'Render domain add failed')}); }
});

gatewayRouter.post('/render/services/:serviceId/domains/:domain/verify', requireCapability('render.domain.write'), async (req: Request, res: Response) => {
  try {
    const keyCtx=(req as any).gatewayKey as GatewayKey;
    const target=selectGatewayConnection('render', req.query.accountId ? String(req.query.accountId) : String(req.body?.accountId || ''), keyCtx);
    const result=await executeToolCall('verify_render_domain',{accountId:target.id,serviceId:req.params.serviceId,domain:req.params.domain},keyCtx.keyName,keyCtx);
    res.status(202).json({success:true,result});
  } catch(err:any){ res.status(500).json({success:false,message:redactSecrets(err.message || 'Render domain verification failed')}); }
});

gatewayRouter.delete('/render/services/:serviceId/domains/:domain', requireCapability('render.domain.write'), async (req: Request, res: Response) => {
  try {
    const keyCtx=(req as any).gatewayKey as GatewayKey;
    if (req.body?.confirmed !== true) return res.status(400).json({success:false,code:'CONFIRMATION_REQUIRED',message:'Custom domain deletion requires confirmed:true.'});
    const target=selectGatewayConnection('render', req.query.accountId ? String(req.query.accountId) : String(req.body?.accountId || ''), keyCtx);
    const result=await executeToolCall('delete_render_domain',{accountId:target.id,serviceId:req.params.serviceId,domain:req.params.domain,confirmed:true},keyCtx.keyName,keyCtx);
    res.json({success:true,result});
  } catch(err:any){ res.status(500).json({success:false,message:redactSecrets(err.message || 'Render domain deletion failed')}); }
});

gatewayRouter.get('/render/services', requireCapability('render.service.list'), async (req: Request, res: Response) => {
  try {
    const result = await executeToolCall('list_render_services', {}, (req as any).gatewayKey.keyName, (req as any).gatewayKey);
    res.json({ success: true, services: result });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

gatewayRouter.post('/render/deployments', requireCapability('render.deploy'), async (req: Request, res: Response) => {
  try {
    const { serviceId, accountId, workspaceId, clearCache } = req.body;
    if (!serviceId) return res.status(400).json({ success: false, message: 'serviceId is required' });
    const key = (req as any).gatewayKey as GatewayKey;
    let target;
    if (accountId) target = selectGatewayConnection('render', String(accountId), key);
    else if (workspaceId) {
      const candidates = db.getConnections('render').filter((c) => {
        const allowed = !key.allowedAccounts?.length || key.allowedAccounts.includes(c.id) || key.allowedAccounts.includes(c.accountId || '');
        return allowed && renderWorkspaceOwns(c, String(workspaceId));
      });
      if (candidates.length !== 1) return res.status(400).json({ success:false, code:'AMBIGUOUS_RENDER_ACCOUNT', message:candidates.length ? 'Multiple Render connections contain that workspace. Specify accountId.' : 'No authorized Render connection owns that workspace.' });
      target = candidates[0];
    } else target = selectGatewayConnection('render', undefined, key);
    const result = await executeToolCall('deploy_render_service', { serviceId, accountId: target.id, workspaceId, clearCache }, key.keyName, key);

    res.json({ success: true, deployment: result });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

gatewayRouter.post('/render/services/:serviceId/restart', requireCapability('render.restart'), async (req: Request, res: Response) => {
  try {
    const { accountId } = req.body;
    const result = await executeToolCall('restart_render_service', { serviceId: req.params.serviceId, accountId }, (req as any).gatewayKey.keyName, (req as any).gatewayKey);
    res.json({ success: true, service: result });
  } catch (err: any) {
    const status = String(err.message || '').includes('Capability') ? 403 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});

gatewayRouter.delete('/render/services/:serviceId', requireCapability('render.service.delete'), async (req: Request, res: Response) => {
  try {
    const { accountId, confirmed } = req.body || {};
    if (!confirmed) {
      return res.status(400).json({
        success: false,
        code: 'CONFIRMATION_REQUIRED',
        message: 'Render service deletion requires explicit confirmation parameter: { confirmed: true }.',
      });
    }
    const result = await executeToolCall('delete_render_service', { serviceId: req.params.serviceId, accountId, confirmed: true }, (req as any).gatewayKey.keyName, (req as any).gatewayKey);
    res.json({ success: true, result });
  } catch (err: any) {
    const status = String(err.message || '').includes('Capability') ? 403 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});


/**
 * Stream an explicitly authorized provider/API resource to the requesting client.
 * This is NOT a browser download capability. It never writes the file into the workspace.
 */
gatewayRouter.get('/files/download', requireCapability('gateway.file.download'), async (req: Request, res: Response) => {
  try {
    const key = (req as any).gatewayKey as GatewayKey;
    const connectionId = String(req.query.connectionId || '');
    const url = String(req.query.url || '');
    if (!connectionId || !url) return res.status(400).json({ success:false, message:'connectionId and url are required.' });
    const conn = selectGatewayConnection(String(req.query.provider || ''), connectionId, key);
    const target = downloadHostAllowed(conn.provider, url);
    const encrypted = db.getEncryptedSecret(conn.id);
    if (!encrypted) throw new Error('Provider credential is not available for this connection.');
    const secret = decryptSecret(encrypted);
    const response = await fetch(target, { headers: { Authorization:`Bearer ${secret}`, Accept:'*/*' }, redirect:'manual' });
    if (!response.ok) throw new Error(`Provider download request failed: HTTP ${response.status}`);
    if ([301,302,303,307,308].includes(response.status)) throw new Error('Provider download redirects are not allowed.');
    const maxBytes = 50 * 1024 * 1024;
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > maxBytes) throw new Error('Requested download exceeds the 50 MB Gateway stream limit.');
    if (contentLength) res.setHeader('Content-Length', String(contentLength));
    const disposition = response.headers.get('content-disposition'); if (disposition) res.setHeader('Content-Disposition', disposition);
    res.setHeader('X-Gateway-Download', 'streamed');
    if (response.body) {
      const reader = response.body.getReader();
      let streamed = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        streamed += value.byteLength;
        if (streamed > maxBytes) { await reader.cancel(); throw new Error('Requested download exceeded the 50 MB Gateway stream limit.'); }
        res.write(Buffer.from(value));
      }
    }
    res.end();
  } catch (err:any) {
    res.status(400).json({ success:false, code:'DOWNLOAD_BLOCKED', message:redactSecrets(err.message || 'Download failed') });
  }
});

/**
 * Browser Endpoints
 */
async function gatewayBrowserAction(req: Request, res: Response, capability: string, action: any, params: any = {}) {
  try {
    const key = (req as any).gatewayKey as GatewayKey;
    const sessionId = String(params.sessionId || req.body?.sessionId || req.query?.sessionId || '');
    if (!sessionId) return res.status(400).json({ success:false, message:'sessionId is required' });
    if (!key.allowedBrowserSessions?.includes(sessionId) && key.allowedBrowserSessions?.length) return res.status(403).json({ success:false, message:'Gateway key is not authorized for this browser session.' });
    const result = await executeToolCall(action, { ...params, sessionId }, key.keyName, key);
    res.json({ success:true, result });
  } catch (err:any) { res.status(String(err.message || '').includes('Capability') ? 403 : 500).json({ success:false, message:err.message }); }
}

gatewayRouter.post('/browser/back', requireCapability('browser.navigate'), (req,res)=>gatewayBrowserAction(req,res,'browser.navigate','browser_back',req.body));
gatewayRouter.post('/browser/forward', requireCapability('browser.navigate'), (req,res)=>gatewayBrowserAction(req,res,'browser.navigate','browser_forward',req.body));
gatewayRouter.post('/browser/refresh', requireCapability('browser.navigate'), (req,res)=>gatewayBrowserAction(req,res,'browser.navigate','browser_refresh',req.body));
gatewayRouter.post('/browser/open-tab', requireCapability('browser.tabs'), (req,res)=>gatewayBrowserAction(req,res,'browser.tabs','browser_open_tab',req.body));
gatewayRouter.post('/browser/switch-tab', requireCapability('browser.tabs'), (req,res)=>gatewayBrowserAction(req,res,'browser.tabs','browser_switch_tab',req.body));
gatewayRouter.post('/browser/close-tab', requireCapability('browser.tabs'), (req,res)=>gatewayBrowserAction(req,res,'browser.tabs','browser_close_tab',req.body));

gatewayRouter.post('/browser/navigate', requireCapability('browser.navigate'), async (req: Request, res: Response) => {
  try {
    const { sessionId, url } = req.body;
    if (!sessionId || !url) return res.status(400).json({ success: false, message: 'sessionId and url required' });

    const result = await executeToolCall('browser_navigate', { sessionId, url }, (req as any).gatewayKey.keyName, (req as any).gatewayKey);
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /v1/connections
 * Safe workspace resource discovery for an authenticated Gateway key.
 * Returns only non-secret metadata, filtered to this key's allowed scopes.
 */
gatewayRouter.get('/connections', requireCapability('gateway.connections.read'), (req: Request, res: Response) => {
  const key = (req as any).gatewayKey as GatewayKey;
  const connections = db.getConnections().filter((c) => {
    const providerAllowed = !key.allowedProviders?.length || key.allowedProviders.includes(c.provider);
    const accountAllowed = !key.allowedAccounts?.length || key.allowedAccounts.includes(c.id) || key.allowedAccounts.includes(c.accountId || '');
    return providerAllowed && accountAllowed;
  }).map((c) => ({
    id: c.id,
    provider: c.provider,
    accountName: c.accountName,
    username: c.username,
    accountId: c.accountId,
    label: c.label,
    purpose: c.purpose,
    status: c.status,
    permissions: c.permissions,
    lastCheckedAt: c.lastCheckedAt,
    lastUsedAt: c.lastUsedAt,
    tokenConfigured: Boolean(db.getEncryptedSecret(c.id)),
  }));

  const browserSessions = db.getBrowserSessions().filter((s) => browserAllowed(key, s.id)).map((s) => ({
    id: s.id,
    sessionName: s.sessionName,
    profileName: s.profileName,
    providerAccountId: s.providerAccountId,
    status: s.status,
    currentUrl: s.currentUrl,
    currentTitle: s.currentTitle,
    waitingHuman: s.waitingHuman,
    lastActivityAt: s.lastActivityAt,
  }));

  res.json({ success: true, connections, browserSessions });
});

function ensureGatewayBrowserScope(req: Request, res: Response) {
  const key = (req as any).gatewayKey as GatewayKey;
  const sessionId = String(req.body?.sessionId || req.query?.sessionId || '');
  if (!sessionId) {
    res.status(400).json({ success: false, code: 'SESSION_REQUIRED', message: 'sessionId is required.' });
    return null;
  }
  if (!browserAllowed(key, sessionId)) {
    res.status(403).json({ success: false, code: 'BROWSER_SCOPE_DENIED', message: 'This Gateway key is not authorized to use that browser session.' });
    return null;
  }
  return sessionId;
}

/**
 * Browser interaction endpoints. File transfer, cookies, passwords, storage,
 * and permission-grant operations intentionally have no Gateway endpoints.
 */
gatewayRouter.post('/browser/click', requireCapability('browser.click'), async (req: Request, res: Response) => {
  try {
    const sessionId = ensureGatewayBrowserScope(req, res); if (!sessionId) return;
    const result = await executeToolCall('browser_click', { sessionId, selector: req.body.selector, text: req.body.text }, (req as any).gatewayKey.keyName, (req as any).gatewayKey);
    res.json({ success: true, result });
  } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
});

gatewayRouter.post('/browser/type', requireCapability('browser.type'), async (req: Request, res: Response) => {
  try {
    const sessionId = ensureGatewayBrowserScope(req, res); if (!sessionId) return;
    const result = await executeToolCall('browser_type', { sessionId, selector: req.body.selector, text: req.body.text }, (req as any).gatewayKey.keyName, (req as any).gatewayKey);
    res.json({ success: true, result });
  } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
});

gatewayRouter.post('/browser/copy', requireCapability('browser.copy'), async (req: Request, res: Response) => {
  try {
    const sessionId = ensureGatewayBrowserScope(req, res); if (!sessionId) return;
    const result = await executeToolCall('browser_copy', { sessionId, selector: req.body.selector }, (req as any).gatewayKey.keyName, (req as any).gatewayKey);
    res.json({ success: true, result });
  } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
});

gatewayRouter.post('/browser/paste', requireCapability('browser.paste'), async (req: Request, res: Response) => {
  try {
    const sessionId = ensureGatewayBrowserScope(req, res); if (!sessionId) return;
    const result = await executeToolCall('browser_paste', { sessionId, selector: req.body.selector, text: req.body.text }, (req as any).gatewayKey.keyName, (req as any).gatewayKey);
    res.json({ success: true, result });
  } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
});

gatewayRouter.post('/browser/scroll', requireCapability('browser.scroll'), async (req: Request, res: Response) => {
  try {
    const sessionId = ensureGatewayBrowserScope(req, res); if (!sessionId) return;
    const result = await executeToolCall('browser_scroll', { sessionId, y: req.body.y }, (req as any).gatewayKey.keyName, (req as any).gatewayKey);
    res.json({ success: true, result });
  } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
});

gatewayRouter.post('/browser/tabs', requireCapability('browser.tabs'), async (req: Request, res: Response) => {
  try {
    const sessionId = ensureGatewayBrowserScope(req, res); if (!sessionId) return;
    const result = await executeToolCall('browser_tabs', { sessionId }, (req as any).gatewayKey.keyName, (req as any).gatewayKey);
    res.json({ success: true, result });
  } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
});

gatewayRouter.get('/browser/screenshot', requireCapability('browser.screenshot'), async (req: Request, res: Response) => {
  try {
    const sessionId = ensureGatewayBrowserScope(req, res); if (!sessionId) return;
    const result = await executeToolCall('browser_screenshot', { sessionId }, (req as any).gatewayKey.keyName, (req as any).gatewayKey);
    res.json({ success: true, result });
  } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
});

gatewayRouter.post('/browser/read-page', requireCapability('browser.read_page'), async (req: Request, res: Response) => {
  try {
    const sessionId = ensureGatewayBrowserScope(req, res); if (!sessionId) return;
    const result = await executeToolCall('browser_read_page', { sessionId }, (req as any).gatewayKey.keyName, (req as any).gatewayKey);
    res.json({ success: true, result });
  } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
});

gatewayRouter.post('/browser/human-handoff', requireCapability('browser.human_handoff'), async (req: Request, res: Response) => {
  try {
    const sessionId = ensureGatewayBrowserScope(req, res); if (!sessionId) return;
    const result = await executeToolCall('browser_handoff', { sessionId, reason: req.body.reason }, (req as any).gatewayKey.keyName, (req as any).gatewayKey);
    res.json({ success: true, result });
  } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
});

/**
 * POST /v1/tokens/request
 * Token Acquisition Request (Requirement 22)
 * If external AI discovers a new API token, it submits this request.
 * Creates pending request on user dashboard; never returns raw secret to external AI.
 */
gatewayRouter.post('/tokens/request', requireCapability('gateway.token.request'), async (req: Request, res: Response) => {
  try {
    const key = (req as any).gatewayKey as GatewayKey;
    const { name, provider, account, token, description, howToUse, requestedPermissions } = req.body;

    if (!name || !provider || !token) {
      return res.status(400).json({ success: false, message: 'name, provider, and token are required' });
    }

    const fingerprint = createTokenFingerprint(token);
    const existing = db.findDuplicateConnection(provider, fingerprint);
    if (existing) {
      return res.status(409).json({
        success: false,
        code: 'TOKEN_ALREADY_EXISTS',
        message: 'This API token is already available in the workspace vault.',
        connectionId: existing.id,
      });
    }
    const pendingDuplicate = db.getTokenRequests().find((item) => item.status === 'pending' && item.provider === provider && item.tokenFingerprint === fingerprint);
    if (pendingDuplicate) {
      return res.status(409).json({
        success: false,
        code: 'TOKEN_REQUEST_ALREADY_PENDING',
        message: 'This API is already available in a pending workspace request.',
        requestId: pendingDuplicate.id,
      });
    }

    const enc = encryptSecret(token);
    const newReq = db.saveTokenRequest({
      id: `req_tok_${Date.now()}`,
      name,
      provider,
      account: account || 'External Discovery',
      requestedBy: key.keyName,
      description: description || 'Token discovered during agent execution',
      howToUse: howToUse || '',
      requestedPermissions: requestedPermissions || [],
      encryptedToken: enc,
      tokenFingerprint: fingerprint,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    db.addSecurityEvent({
      id: `sec_${Date.now()}`,
      timestamp: new Date().toISOString(),
      eventType: 'TOKEN_ACQUISITION_REQUEST_SUBMITTED',
      actor: key.keyName,
      severity: 'medium',
      details: `New API token request for ${provider} submitted by ${key.keyName}. Pending user approval.`,
      resolved: false,
    });

    res.json({
      success: true,
      requestId: newReq.id,
      message: 'Token acquisition request submitted. It will become active once approved by workspace owner.',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});
