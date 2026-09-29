import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../database/db.js';
import {
  encryptSecret,
  decryptSecret,
  createTokenFingerprint,
  getSecretLast4,
  hashGatewayKey,
  hashBrowserPairingCode,
  redactSecrets,
} from '../security/vault.js';
import { getProviderAdapter, getAllSupportedProviders } from '../providers/index.js';
import { processAgentMessage } from '../ai/agent.service.js';
import { browserManager } from '../browser/browser.manager.js';
import { analyzeZipBuffer } from '../deployment/zip.analyzer.js';
import { classifyDeploymentLogs } from '../deployment/relationship.engine.js';
import { taskEngine } from '../tasks/task.engine.js';
import type { ProviderConnection, GatewayKey, BrowserSession, Project } from '../../shared/types.js';
import { SYSTEM_CAPABILITIES } from '../../shared/capabilities.js';
import { renderWorkspaceById, renderWorkspaceOwns } from '../providers/render/workspace.js';
import { authenticateOwnerPassword, createOwnerSession, destroyOwnerSession, isOwnerAuthenticated, ownerAuthConfigured, requireOwnerAuth } from '../security/owner-auth.js';
import { getRateSnapshot } from '../gateway/gateway.router.js';

export const apiRouter = Router();

// Owner authentication endpoints are public; all other /api routes require the owner session.
apiRouter.get('/auth/status', (req: Request, res: Response) => {
  res.json({ success: true, configured: ownerAuthConfigured(), authenticated: isOwnerAuthenticated(req), vaultConfigured: Boolean(process.env.ENCRYPTION_MASTER_KEY) });
});

apiRouter.post('/auth/login', (req: Request, res: Response) => {
  if (!ownerAuthConfigured()) {
    return res.status(503).json({ success: false, code: 'OWNER_AUTH_NOT_CONFIGURED', message: 'Set OWNER_PASSWORD to a strong secret in the server environment first.' });
  }
  if (!authenticateOwnerPassword(req.body?.password, req.ip || 'unknown')) {
    return res.status(401).json({ success: false, code: 'INVALID_PASSWORD', message: 'Invalid owner password.' });
  }
  createOwnerSession(res);
  res.json({ success: true, authenticated: true });
});

apiRouter.post('/auth/logout', (req: Request, res: Response) => {
  destroyOwnerSession(req, res);
  res.json({ success: true });
});

apiRouter.use(requireOwnerAuth);
apiRouter.get('/providers', (_req: Request, res: Response) => {
  res.json({ success: true, providers: getAllSupportedProviders() });
});

apiRouter.get('/ai/status', (_req: Request, res: Response) => {
  res.json({ success: true, brain: { status: 'not_configured', mode: 'user-owned/self-hosted', externalAiDependency: false, chatEnabled: false } });
});


/**
 * 1. AI Chat Endpoint
 */
apiRouter.post('/chat', async (req: Request, res: Response) => {
  try {
    const { message, history } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ success: false, message: 'Field "message" is required' });
    }

    const result = await processAgentMessage(message, history || []);
    res.json({
      success: true,
      text: result.text,
      plan: result.plan,
      executedTools: result.executedTools,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 2. Provider Accounts Management
 */
apiRouter.get('/accounts', (req: Request, res: Response) => {
  const { provider } = req.query;
  const conns = db.getConnections(provider ? String(provider) : undefined);
  res.json({ success: true, accounts: conns });
});

apiRouter.post('/accounts', async (req: Request, res: Response) => {
  try {
    const { provider, name, token, label, purpose, description, howToUse } = req.body;
    if (!provider || !token || !name) {
      return res.status(400).json({ success: false, message: 'Provider, name, and token are required' });
    }

    const cleanToken = token.trim();
    const fingerprint = createTokenFingerprint(cleanToken);

    // Duplicate detection (Requirement 21)
    const existing = db.findDuplicateConnection(provider, fingerprint);
    if (existing) {
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_TOKEN',
        message: `This API credential is already connected as "${existing.accountName}". Duplicate storage prevented.`,
        existingConnection: existing,
      });
    }

    // Call real provider adapter to validate credential and resolve real account identity
    const adapter = getProviderAdapter(provider);
    const validation = await adapter.validateCredential(cleanToken);

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_CREDENTIAL',
        message: validation.error || `Failed to authenticate with ${provider}. Please verify your token.`,
      });
    }

    const identity = validation.identity!;
    const encSecret = encryptSecret(cleanToken);
    const connId = `conn_${provider}_${Date.now()}`;

    const newConn: ProviderConnection = {
      id: connId,
      provider: provider as any,
      accountName: identity.accountName,
      label: label || name || identity.organization || undefined,
      purpose: purpose || 'Personal development and automation',
      description: description || '',
      howToUse: howToUse || '',
      username: identity.username || identity.accountName,
      avatarUrl: identity.avatarUrl,
      accountId: identity.accountId,
      status: 'valid',
      permissions: identity.scopes?.length ? identity.scopes : [],
      rateLimit: identity.rateLimit,
      lastCheckedAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      secretFingerprint: fingerprint,
      tokenLast4: getSecretLast4(cleanToken),
      metadata: { ...(identity.metadata || {}), connectionAlias: name },
    };

    db.saveConnection(newConn, encSecret);

    db.addSecurityEvent({
      id: `sec_${Date.now()}`,
      timestamp: new Date().toISOString(),
      eventType: 'PROVIDER_CREDENTIAL_ADDED',
      actor: 'Owner',
      severity: 'low',
      details: `Connected ${provider} account: ${newConn.username || newConn.accountName}`,
      resolved: true,
    });

    res.json({ success: true, account: newConn });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

apiRouter.put('/accounts/:id/metadata', (req: Request, res: Response) => {
  const conn = db.getConnectionById(req.params.id);
  if (!conn) return res.status(404).json({ success:false, message:'Connection not found' });
  for (const key of ['accountName','label','purpose','description','howToUse']) {
    if (key in req.body && typeof req.body[key] === 'string') (conn as any)[key] = req.body[key].trim();
  }
  conn.updatedAt = new Date().toISOString();
  const secret = db.getEncryptedSecret(conn.id);
  if (!secret) return res.status(400).json({ success:false, message:'Stored secret is missing.' });
  db.saveConnection(conn, secret);
  db.addSecurityEvent({ id:`sec_${Date.now()}`, timestamp:new Date().toISOString(), eventType:'PROVIDER_CONNECTION_METADATA_UPDATED', actor:'Owner', severity:'low', details:`Updated connection metadata for ${conn.provider}:${conn.id}.`, resolved:true });
  res.json({ success:true, account:conn });
});

apiRouter.post('/accounts/:id/test', async (req: Request, res: Response) => {
  try {
    const conn = db.getConnectionById(req.params.id);
    if (!conn) return res.status(404).json({ success: false, message: 'Connection not found' });

    const enc = db.getEncryptedSecret(conn.id);
    if (!enc) return res.status(400).json({ success: false, message: 'Stored secret missing' });

    const secret = decryptSecret(enc);
    const adapter = getProviderAdapter(conn.provider);
    const health = await adapter.healthCheck(secret);

    conn.status = health.healthy ? 'valid' : 'invalid';
    conn.lastCheckedAt = new Date().toISOString();
    if (health.rateLimit) {
      conn.rateLimit = {
        limit: health.rateLimit.limit,
        remaining: health.rateLimit.remaining,
      };
    }
    db.saveConnection(conn, enc);

    res.json({
      success: true,
      healthy: health.healthy,
      latencyMs: health.latencyMs,
      message: health.message,
      rateLimit: health.rateLimit,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

apiRouter.delete('/accounts/:id', async (req: Request, res: Response) => {
  if (req.body?.confirmed !== true) return res.status(400).json({ success:false, code:'CONFIRMATION_REQUIRED', message:'Explicit confirmation is required before removing a provider connection.' });
  try {
    const conn = db.getConnectionById(req.params.id);
    if (!conn) return res.status(404).json({ success: false, message: 'Connection not found' });

    // Try remote revocation only when the provider adapter explicitly supports it.
    let remotelyRevoked = false;
    const enc = db.getEncryptedSecret(conn.id);
    if (enc) {
      try {
        const secret = decryptSecret(enc);
        const adapter = getProviderAdapter(conn.provider);
        remotelyRevoked = await adapter.revoke(secret);
      } catch {
        remotelyRevoked = false;
      }
    }

    db.deleteConnection(conn.id);

    db.addSecurityEvent({
      id: `sec_${Date.now()}`,
      timestamp: new Date().toISOString(),
      eventType: 'PROVIDER_CREDENTIAL_REMOVED',
      actor: 'Owner',
      severity: 'medium',
      details: `Removed connection: ${conn.provider} (${conn.accountName}). Stored secret destroyed. Remote revocation ${remotelyRevoked ? 'confirmed' : 'not performed/supported by adapter'}.`,
      resolved: true,
    });

    res.json({ success: true, message: 'Connection removed and credential destroyed.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 3. Projects
 */
apiRouter.get('/projects', (req: Request, res: Response) => {
  res.json({ success: true, projects: db.getProjects() });
});

apiRouter.post('/projects', (req: Request, res: Response) => {
  const { name, description, projectType, githubAccountId, repoOwner, repoName, branch, renderWorkspaceId, renderWorkspaceOwnerId, renderWorkspaceName, renderServiceId, buildCommand, startCommand, envVarNames, uploadId } = req.body;
  if (!name) return res.status(400).json({ success: false, message: 'Project name is required' });
  let resolvedRenderWorkspaceOwnerId = renderWorkspaceOwnerId || undefined;
  let resolvedRenderWorkspaceName = renderWorkspaceName || undefined;
  if (renderWorkspaceId) {
    const renderConn = db.getConnectionById(String(renderWorkspaceId));
    if (!renderConn || renderConn.provider !== 'render') return res.status(400).json({ success:false, message:'Selected Render API connection was not found.' });
    if (resolvedRenderWorkspaceOwnerId && !renderWorkspaceOwns(renderConn, String(resolvedRenderWorkspaceOwnerId))) return res.status(400).json({ success:false, message:'Selected Render workspace is not available to the chosen Render API key.' });
    if (!resolvedRenderWorkspaceOwnerId) {
      const workspaces = Array.isArray(renderConn.metadata?.workspaces) ? renderConn.metadata.workspaces : [];
      if (workspaces.length === 1) resolvedRenderWorkspaceOwnerId = String(workspaces[0].id);
      if (workspaces.length > 1) return res.status(400).json({ success:false, message:'The selected Render API key has multiple workspaces. Select the exact workspace before saving the project.' });
    }
    if (resolvedRenderWorkspaceOwnerId) resolvedRenderWorkspaceName = renderWorkspaceById(renderConn, resolvedRenderWorkspaceOwnerId)?.name || resolvedRenderWorkspaceName;
  }

  const project: Project = {
    id: `proj_${Date.now()}`,
    name,
    description,
    projectType: ['node_express','react_vite','nextjs','static','docker','unknown'].includes(projectType) ? projectType : 'unknown',
    githubAccountId,
    repoOwner,
    repoName,
    branch: branch || 'main',
    renderWorkspaceId,
    renderWorkspaceOwnerId: resolvedRenderWorkspaceOwnerId,
    renderWorkspaceName: resolvedRenderWorkspaceName,
    renderServiceId,
    buildCommand: buildCommand || undefined,
    startCommand: startCommand || undefined,
    uploadId: uploadId || undefined,
    archivePath: uploadId ? path.resolve(process.cwd(), 'data', 'uploads', `${uploadId}.zip`) : undefined,
    envVarNames: envVarNames || [],
    autoFix: false,
    status: 'idle',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  db.saveProject(project);
  res.json({ success: true, project });
});

apiRouter.delete('/projects/:id', (req: Request, res: Response) => {
  if (req.body?.confirmed !== true) return res.status(400).json({ success:false, code:'CONFIRMATION_REQUIRED', message:'Explicit confirmation is required before deleting a project.' });
  const deleted = db.deleteProject(req.params.id);
  res.json({ success: deleted });
});

/**
 * 4. Deployments
 */
apiRouter.get('/deployments', (req: Request, res: Response) => {
  const { projectId } = req.query;
  res.json({ success: true, deployments: db.getDeployments(projectId ? String(projectId) : undefined) });
});

apiRouter.post('/deployments/diagnose', (req: Request, res: Response) => {
  const { logs } = req.body;
  if (!logs || !Array.isArray(logs)) {
    return res.status(400).json({ success: false, message: 'logs array is required' });
  }
  const diagnosis = classifyDeploymentLogs(logs);
  res.json({ success: true, diagnosis });
});

apiRouter.post('/deployments/:id/rollback', async (req: Request, res: Response) => {
  try {
    const dep = db.getDeploymentById(req.params.id);
    if (!dep) return res.status(404).json({ success: false, message: 'Deployment not found' });
    if (dep.provider !== 'render') return res.status(400).json({ success: false, message: 'Rollback is only supported for Render deployments.' });
    if (!req.body?.confirmed) return res.status(400).json({ success: false, code: 'CONFIRMATION_REQUIRED', message: 'Rollback confirmation is required.' });
    const project = db.getProjectById(dep.projectId);
    if (!project?.renderServiceId || !project.renderWorkspaceId) return res.status(400).json({ success: false, message: 'Project is missing Render service/workspace mapping.' });
    const conn = db.getConnectionById(project.renderWorkspaceId);
    if (!conn) return res.status(400).json({ success: false, message: 'Render connection not found.' });
    const { executeToolCall } = await import('../ai/agent.service.js');
    const result = await executeToolCall('rollback_render_deployment', { accountId: conn.id, serviceId: project.renderServiceId, deployId: req.body.targetDeployId, confirmed: true }, 'Owner');
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, message: redactSecrets(err.message || 'Rollback failed') });
  }
});



/**
 * 5. Browser Sessions & Automation
 */
apiRouter.get('/browser/sessions', (req: Request, res: Response) => {
  res.json({ success: true, sessions: browserManager.getSessionsForUi() });
});

apiRouter.post('/browser/sessions', (req: Request, res: Response) => {
  const { sessionName, providerAccountId } = req.body;
  if (providerAccountId) {
    const account = db.getConnectionById(String(providerAccountId));
    if (!account) return res.status(400).json({ success:false, message:'The selected linked provider account does not exist.' });
  }
  const session: BrowserSession = {
    id: `sess_${Date.now()}`,
    sessionName: sessionName || 'Default Chrome Session',
    providerAccountId,
    profileName: `profile_${Date.now()}`,
    status: 'disconnected',
    currentUrl: 'about:blank',
    currentTitle: 'New Tab',
    waitingHuman: false,
    lastActivityAt: new Date().toISOString(),
  };

  db.saveBrowserSession(session);
  res.json({ success: true, session });
});

apiRouter.post('/browser/sessions/:id/pairing', (req: Request, res: Response) => {
  try {
    const session = db.getBrowserSessionById(req.params.id);
    if (!session) return res.status(404).json({ success:false, message:'Browser session not found.' });
    const code = crypto.randomBytes(8).toString('hex');
    session.pairingCodeHash = hashBrowserPairingCode(code);
    session.pairingExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    db.saveBrowserSession(session);
    db.addSecurityEvent({ id:`sec_${Date.now()}`, timestamp:new Date().toISOString(), eventType:'BROWSER_AGENT_PAIRING_CODE_CREATED', actor:'Owner', severity:'medium', details:`Created a 30-minute pairing code for browser session ${session.id}.`, resolved:true });
    res.json({ success:true, sessionId:session.id, expiresAt:session.pairingExpiresAt, pairingCode:code });
  } catch (err:any) {
    res.status(500).json({ success:false, message:redactSecrets(err.message || 'Could not create pairing code') });
  }
});

apiRouter.post('/browser/action', async (req: Request, res: Response) => {
  try {
    const { sessionId, action, params } = req.body;
    if (!sessionId || !action) {
      return res.status(400).json({ success: false, message: 'sessionId and action are required' });
    }

    const started = Date.now();
    const requestId = `req_browser_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
    try {
      const result = await browserManager.executeAction({ sessionId, action, params });
      db.addActivityLog({ id:`log_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`, timestamp:new Date().toISOString(), requestId, actor:'Owner', agentId:'owner', provider:'browser', account:sessionId, operation:`browser.${action}`, target:params?.url || params?.selector || sessionId, status:'success', durationMs:Date.now()-started, humanApproval:result?.humanRequired === true, browserSessionId:sessionId });
      return res.json({ success: true, result });
    } catch (err:any) {
      const safe = redactSecrets(String(err.message || err));
      db.addActivityLog({ id:`log_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`, timestamp:new Date().toISOString(), requestId, actor:'Owner', agentId:'owner', provider:'browser', account:sessionId, operation:`browser.${action}`, target:params?.url || params?.selector || sessionId, status:'failed', durationMs:Date.now()-started, errorCategory:'BROWSER_ERROR', safeErrorMessage:typeof safe === 'string' ? safe : JSON.stringify(safe), browserSessionId:sessionId });
      return res.status(500).json({ success: false, message: safe });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, message: redactSecrets(err.message || err) });
  }
});

apiRouter.post('/browser/resume', (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body;
    const session = browserManager.resumeAfterHuman(sessionId);
    res.json({ success: true, session });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 6. Gateway Keys & Live Permissions
 */
apiRouter.get('/gateway/keys', (req: Request, res: Response) => {
  const keys = db.getGatewayKeys().map((key) => {
    const rate = getRateSnapshot(key.id, key.rateLimit || 60);
    const expired = Boolean(key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now());
    return {
      ...key,
      status: expired && key.status === 'active' ? 'expired' : key.status,
      rateUsed: rate.used,
      rateRemaining: rate.remaining,
      rateResetMs: rate.resetMs,
    };
  });
  res.json({ success: true, keys });
});

apiRouter.patch('/gateway/keys/:id', (req: Request, res: Response) => {
  const key = db.getGatewayKeyById(req.params.id);
  if (!key) return res.status(404).json({ success: false, message: 'Gateway key not found' });
  const nextName = typeof req.body?.keyName === 'string' ? req.body.keyName.trim() : '';
  const nextDesc = typeof req.body?.description === 'string' ? req.body.description.trim() : undefined;
  if (nextName) {
    if (nextName.length > 100) return res.status(400).json({ success: false, message: 'Key name is too long.' });
    key.keyName = nextName;
  }
  if (nextDesc !== undefined) key.description = nextDesc;
  db.saveGatewayKey(key);
  res.json({ success: true, key });
});

apiRouter.post('/gateway/keys/import', (req: Request, res: Response) => {
  const rawSecret = String(req.body?.rawKey || req.body?.key || '').trim();
  const keyName = String(req.body?.keyName || 'Full access').trim() || 'Full access';
  if (!rawSecret.startsWith('gw_') || rawSecret.length < 20) {
    return res.status(400).json({ success: false, message: 'Provide rawKey starting with gw_.' });
  }
  const keyHash = hashGatewayKey(rawSecret);
  const existing = db.findGatewayKeyByHash(keyHash);
  const lockedCapabilities = new Set(['browser.download','browser.upload','browser.cookie.read','browser.cookie.write','browser.cookie.delete','browser.storage.read','browser.storage.write','browser.password.read','browser.permission.grant']);
  const caps: Record<string, boolean> = Object.fromEntries(
    SYSTEM_CAPABILITIES.map((cap) => [cap.id, !lockedCapabilities.has(cap.id)])
  );
  const now = new Date().toISOString();
  const key: GatewayKey = existing ? {
    ...existing,
    keyName,
    description: String(req.body?.description || existing.description || 'Full access across connected accounts'),
    status: 'active',
    rateLimit: Math.max(existing.rateLimit || 60, 1000),
    allowedProviders: [],
    allowedAccounts: [],
    allowedBrowserSessions: [],
    expiresAt: undefined,
    permissionVersion: (existing.permissionVersion || 1) + 1,
    capabilities: caps,
  } : {
    id: `gwk_${Date.now()}`,
    keyName,
    keyPrefix: rawSecret.slice(0, 7),
    keyLast4: rawSecret.slice(-4),
    description: String(req.body?.description || 'Full access across connected accounts'),
    status: 'active',
    rateLimit: 1000,
    allowedProviders: [],
    allowedAccounts: [],
    allowedBrowserSessions: [],
    createdAt: now,
    permissionVersion: 1,
    capabilities: caps,
  };
  db.saveGatewayKey(key, keyHash);
  db.addSecurityEvent({
    id: `sec_${Date.now()}`,
    timestamp: now,
    eventType: 'GATEWAY_KEY_IMPORTED',
    actor: 'Owner',
    severity: 'high',
    details: `Imported/updated full-access Gateway key "${keyName}".`,
    resolved: true,
  });
  const safe = { ...key } as any;
  delete safe.keyHash;
  res.json({ success: true, key: safe, imported: true });
});

apiRouter.post('/gateway/keys', (req: Request, res: Response) => {
  const { keyName, description, rateLimit, allowedProviders, allowedAccounts, allowedBrowserSessions, capabilities, expiresAt } = req.body;
  if (!keyName || typeof keyName !== 'string' || keyName.trim().length > 100) return res.status(400).json({ success: false, message: 'A valid key name is required.' });

  // Generate real gateway API key: gw_<32 hex chars>
  const rawSecret = `gw_${crypto.randomBytes(24).toString('hex')}`;
  const keyHash = hashGatewayKey(rawSecret);
  const keyPrefix = rawSecret.slice(0, 7);
  const keyLast4 = rawSecret.slice(-4);

  const lockedCapabilities = new Set(['browser.download','browser.upload','browser.cookie.read','browser.cookie.write','browser.cookie.delete','browser.storage.read','browser.storage.write','browser.password.read','browser.permission.grant']);
  const defaultCaps: Record<string, boolean> = Object.fromEntries(
    SYSTEM_CAPABILITIES.map((cap) => [cap.id, lockedCapabilities.has(cap.id) ? false : false])
  );
  if (capabilities && typeof capabilities === 'object' && !Array.isArray(capabilities)) {
    for (const cap of SYSTEM_CAPABILITIES) {
      if (cap.id in capabilities && typeof capabilities[cap.id] === 'boolean' && !lockedCapabilities.has(cap.id)) defaultCaps[cap.id] = capabilities[cap.id];
    }
  }
  const safeRateLimit = Math.max(1, Math.min(1000000, Number(rateLimit) || 60));
  const safeExpiresAt = expiresAt ? new Date(String(expiresAt)) : undefined;
  if (safeExpiresAt && Number.isNaN(safeExpiresAt.getTime())) return res.status(400).json({ success:false, message:'Invalid expiresAt value.' });
  if (safeExpiresAt && safeExpiresAt.getTime() <= Date.now()) return res.status(400).json({ success:false, message:'expiresAt must be in the future.' });

  const newKey: GatewayKey = {
    id: `gwk_${Date.now()}`,
    keyName,
    keyPrefix,
    keyLast4,
    description: description || 'External AI Agent Key',
    status: 'active',
    rateLimit: safeRateLimit,
    allowedProviders: Array.isArray(allowedProviders) ? allowedProviders.map(String) : [],
    allowedAccounts: Array.isArray(allowedAccounts) ? allowedAccounts.map(String) : [],
    allowedBrowserSessions: Array.isArray(allowedBrowserSessions) ? allowedBrowserSessions.map(String) : [],
    expiresAt: safeExpiresAt?.toISOString(),
    createdAt: new Date().toISOString(),
    permissionVersion: 1,
    capabilities: defaultCaps,
  };

  db.saveGatewayKey(newKey, keyHash);

  db.addSecurityEvent({
    id: `sec_${Date.now()}`,
    timestamp: new Date().toISOString(),
    eventType: 'GATEWAY_KEY_CREATED',
    actor: 'Owner',
    severity: 'medium',
    details: `Created Gateway key "${keyName}" with ${Object.keys(defaultCaps).length} capabilities.`,
    resolved: true,
  });

  // Return the raw key ONCE upon creation
  res.json({
    success: true,
    key: newKey,
    rawKey: rawSecret, // Shown ONLY once
  });
});

/**
 * PUT /api/gateway/keys/:id/permissions
 * CRITICAL REQUIREMENT 26: The Gateway API key MUST remain the SAME when permissions change!
 * Do NOT generate a new API key.
 */
apiRouter.put('/gateway/keys/:id/permissions', (req: Request, res: Response) => {
  const { capabilities } = req.body;
  const key = db.getGatewayKeyById(req.params.id);
  if (!key) return res.status(404).json({ success: false, message: 'Gateway key not found' });

  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) return res.status(400).json({ success:false, message:'capabilities must be an object.' });
  const locked = new Set(['browser.download','browser.upload','browser.cookie.read','browser.cookie.write','browser.cookie.delete','browser.storage.read','browser.storage.write','browser.password.read','browser.permission.grant']);
  const nextCapabilities = { ...key.capabilities };
  for (const [capId, value] of Object.entries(capabilities)) {
    if (!SYSTEM_CAPABILITIES.some((c) => c.id === capId)) continue;
    if (locked.has(capId)) { nextCapabilities[capId] = false; continue; }
    if (typeof value === 'boolean') nextCapabilities[capId] = value;
  }
  key.capabilities = nextCapabilities;
  key.permissionVersion = (key.permissionVersion || 1) + 1;
  db.saveGatewayKey(key);

  db.addSecurityEvent({
    id: `sec_${Date.now()}`,
    timestamp: new Date().toISOString(),
    eventType: 'GATEWAY_KEY_PERMISSIONS_UPDATED',
    actor: 'Owner',
    severity: 'medium',
    details: `Updated permissions for Gateway key "${key.keyName}" (Revision v${key.permissionVersion}). Key remains identical.`,
    resolved: true,
  });

  res.json({
    success: true,
    message: 'Permissions updated successfully. The key remains unchanged and takes effect immediately.',
    key,
  });
});

apiRouter.put('/gateway/keys/:id/access', (req: Request, res: Response) => {
  const key = db.getGatewayKeyById(req.params.id);
  if (!key) return res.status(404).json({ success: false, message: 'Gateway key not found' });
  if (Array.isArray(req.body.allowedProviders)) {
    const allowedProviders = req.body.allowedProviders.map(String).filter((p: string) => getAllSupportedProviders().includes(p));
    key.allowedProviders = [...new Set(allowedProviders)];
  }
  if (Array.isArray(req.body.allowedAccounts)) {
    const existingIds = new Set(db.getConnections().map((c) => c.id));
    const existingAccountIds = new Set(db.getConnections().map((c) => c.accountId).filter(Boolean));
    const values = req.body.allowedAccounts.map(String).filter((id: string) => existingIds.has(id) || existingAccountIds.has(id));
    key.allowedAccounts = [...new Set(values)];
  }
  if (Array.isArray(req.body.allowedBrowserSessions)) {
    const existingSessions = new Set(db.getBrowserSessions().map((s) => s.id));
    key.allowedBrowserSessions = [...new Set(req.body.allowedBrowserSessions.map(String).filter((id: string) => existingSessions.has(id)))];
  }
  if ('expiresAt' in req.body) {
    if (req.body.expiresAt === null || req.body.expiresAt === '') key.expiresAt = undefined;
    else {
      const dt = new Date(String(req.body.expiresAt));
      if (Number.isNaN(dt.getTime()) || dt.getTime() <= Date.now()) return res.status(400).json({ success:false, message:'Invalid future expiresAt value.' });
      key.expiresAt = dt.toISOString();
    }
  }
  key.permissionVersion = (key.permissionVersion || 1) + 1;
  db.saveGatewayKey(key);
  db.addSecurityEvent({
    id: `sec_${Date.now()}`,
    timestamp: new Date().toISOString(),
    eventType: 'GATEWAY_KEY_SCOPE_UPDATED',
    actor: 'Owner',
    severity: 'medium',
    details: `Updated account/provider/browser scope for Gateway key "${key.keyName}" (Revision v${key.permissionVersion}).`,
    resolved: true,
  });
  res.json({ success: true, message: 'Gateway access scope updated. The key remains unchanged.', key });
});

apiRouter.post('/gateway/keys/:id/status', (req: Request, res: Response) => {
  const key = db.getGatewayKeyById(req.params.id);
  if (!key) return res.status(404).json({ success:false, message:'Gateway key not found' });
  const status = req.body?.status;
  if (status !== 'active' && status !== 'disabled') return res.status(400).json({ success:false, message:'Status must be active or disabled.' });
  key.status = status;
  db.saveGatewayKey(key);
  db.addSecurityEvent({ id:`sec_${Date.now()}`, timestamp:new Date().toISOString(), eventType:'GATEWAY_KEY_STATUS_CHANGED', actor:'Owner', severity:'medium', details:`Gateway key "${key.keyName}" changed to ${status}.`, resolved:true });
  res.json({ success:true, message:`Gateway key ${status}.`, key });
});

apiRouter.post('/gateway/keys/:id/revoke', (req: Request, res: Response) => {
  const key = db.getGatewayKeyById(req.params.id);
  if (!key) return res.status(404).json({ success: false, message: 'Gateway key not found' });

  key.status = 'revoked';
  db.saveGatewayKey(key);

  db.addSecurityEvent({
    id: `sec_${Date.now()}`,
    timestamp: new Date().toISOString(),
    eventType: 'GATEWAY_KEY_REVOKED',
    actor: 'Owner',
    severity: 'high',
    details: `Gateway key "${key.keyName}" revoked immediately.`,
    resolved: true,
  });

  res.json({ success: true, message: 'Gateway key revoked immediately.' });
});

apiRouter.delete('/gateway/keys/:id', (req: Request, res: Response) => {
  const key = db.getGatewayKeyById(req.params.id);
  if (!key) return res.status(404).json({ success:false, message:'Gateway key not found' });
  const deleted = db.deleteGatewayKey(req.params.id);
  if (deleted) db.addSecurityEvent({ id:`sec_${Date.now()}`, timestamp:new Date().toISOString(), eventType:'GATEWAY_KEY_DELETED', actor:'Owner', severity:'high', details:`Deleted Gateway key ${key.keyName}.`, resolved:true });
  res.json({ success: deleted });
});

/**
 * Token Acquisition Requests (Requirement 22 & 140)
 */
apiRouter.get('/gateway/requests', (req: Request, res: Response) => {
  const requests = db.getTokenRequests().map((r: any) => ({
    id: r.id,
    name: r.name,
    provider: r.provider,
    account: r.account,
    requestedBy: r.requestedBy,
    description: r.description,
    howToUse: r.howToUse,
    requestedPermissions: r.requestedPermissions,
    status: r.status,
    createdAt: r.createdAt,
    tokenLast4: r.tokenLast4 || '****',
  }));
  res.json({ success: true, requests });
});

apiRouter.post('/gateway/requests/:id/approve', async (req: Request, res: Response) => {
  try {
    const tokenReq = db.getTokenRequestById(req.params.id);
    if (!tokenReq) return res.status(404).json({ success: false, message: 'Request not found' });

    const rawToken = decryptSecret(tokenReq.encryptedToken);
    const adapter = getProviderAdapter(tokenReq.provider);
    const val = await adapter.validateCredential(rawToken);
    if (!val.valid || !val.identity) {
      tokenReq.status = 'rejected';
      db.saveTokenRequest(tokenReq);
      return res.status(400).json({ success: false, code: 'INVALID_CREDENTIAL', message: val.error || 'The requested token could not be validated by the provider.' });
    }

    const identity = val.identity;
    const existing = db.findDuplicateConnection(tokenReq.provider, tokenReq.tokenFingerprint);
    if (existing) {
      tokenReq.status = 'rejected';
      db.saveTokenRequest(tokenReq);
      return res.status(409).json({ success: false, code: 'DUPLICATE_TOKEN', message: 'This API is already available in workspace.', existingConnection: { id: existing.id, accountName: existing.accountName, provider: existing.provider } });
    }

    const requested = Array.isArray(tokenReq.requestedPermissions) ? tokenReq.requestedPermissions.filter((p) => typeof p === 'string') : [];
    const ownerPermissions = Array.isArray(req.body?.permissions) ? req.body.permissions.filter((p: any) => typeof p === 'string') : null;
    const allowedPermissionIds = new Set(SYSTEM_CAPABILITIES.map((c) => c.id));
    const providerPrefix = `${tokenReq.provider}.`;
    const selectedPermissions = (ownerPermissions || requested).filter((p: string) => allowedPermissionIds.has(p) && p.startsWith(providerPrefix));
    const permissions = selectedPermissions.length ? selectedPermissions : (identity.scopes?.length ? identity.scopes : []);

    const newConn: ProviderConnection = {
      id: `conn_${tokenReq.provider}_${Date.now()}`,
      provider: tokenReq.provider,
      accountName: identity.accountName,
      label: 'Approved from AI Request',
      purpose: tokenReq.howToUse,
      description: tokenReq.description,
      howToUse: tokenReq.howToUse,
      username: identity.username || identity.accountName,
      avatarUrl: identity.avatarUrl,
      accountId: identity.accountId,
      status: val.valid ? 'valid' : 'connected',
      permissions,
      lastCheckedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      secretFingerprint: tokenReq.tokenFingerprint,
      tokenLast4: getSecretLast4(rawToken),
    };

    db.saveConnection(newConn, tokenReq.encryptedToken);
    tokenReq.status = 'approved';
    db.saveTokenRequest(tokenReq);

    res.json({ success: true, connection: newConn });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

apiRouter.post('/gateway/requests/:id/reject', (req: Request, res: Response) => {
  const tokenReq = db.getTokenRequestById(req.params.id);
  if (!tokenReq) return res.status(404).json({ success: false, message: 'Request not found' });
  tokenReq.status = 'rejected';
  db.saveTokenRequest(tokenReq);
  res.json({ success: true });
});

/**
 * 7. Real-Time Activity Logs & Security Events
 */
apiRouter.get('/logs', (req: Request, res: Response) => {
  const { actor, provider, status, limit, format } = req.query;
  const logs = db.getActivityLogs({
    actor: actor ? String(actor) : undefined,
    provider: provider ? String(provider) : undefined,
    status: status ? String(status) : undefined,
    limit: limit ? parseInt(String(limit), 10) : 200,
  });

  if (format === 'csv') {
    const header = 'Timestamp,Actor,Provider,Operation,Status,DurationMs,SafeErrorMessage\n';
    const rows = logs
      .map(
        (l) =>
          `"${l.timestamp}","${l.actor}","${l.provider || ''}","${l.operation}","${l.status}","${l.durationMs}","${(l.safeErrorMessage || '').replace(/"/g, '""')}"`
      )
      .join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=activity_logs.csv');
    return res.send(header + rows);
  }

  res.json({ success: true, logs: redactSecrets(logs) });
});

apiRouter.get('/security-events', (req: Request, res: Response) => {
  res.json({ success: true, events: db.getSecurityEvents() });
});

/**
 * 8. Task Engine API
 */
apiRouter.get('/tasks', (req: Request, res: Response) => {
  res.json({ success: true, tasks: db.getTasks() });
});

apiRouter.get('/tasks/:id', (req: Request, res: Response) => {
  const task = db.getTaskById(req.params.id);
  if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
  res.json({ success: true, task });
});

apiRouter.post('/tasks/:id/cancel', (req: Request, res: Response) => {
  const task = taskEngine.cancelTask(req.params.id, req.body.reason);
  res.json({ success: true, task });
});

/**
 * 9. Resource Graph
 */
apiRouter.get('/graph', (req: Request, res: Response) => {
  const accounts = db.getConnections();
  const projects = db.getProjects();
  const deployments = db.getDeployments();
  const sessions = db.getBrowserSessions();
  const keys = db.getGatewayKeys();

  const nodes: any[] = [];
  const edges: any[] = [];

  for (const acc of accounts) {
    nodes.push({ id: acc.id, label: `${acc.provider.toUpperCase()}: ${acc.username || acc.accountName}`, type: 'account', status: acc.status });
  }

  for (const proj of projects) {
    nodes.push({ id: proj.id, label: `Project: ${proj.name}`, type: 'project', status: proj.status });
    if (proj.githubAccountId) {
      edges.push({ source: proj.githubAccountId, target: proj.id, label: 'hosts repository' });
    }
    if (proj.renderWorkspaceId) {
      if (proj.renderWorkspaceOwnerId) {
        const workspaceNodeId = `render-workspace:${proj.renderWorkspaceId}:${proj.renderWorkspaceOwnerId}`;
        nodes.push({ id: workspaceNodeId, label: `Render Workspace: ${proj.renderWorkspaceName || proj.renderWorkspaceOwnerId}`, type: 'workspace', status: 'configured', metadata: { connectionId: proj.renderWorkspaceId, ownerId: proj.renderWorkspaceOwnerId } });
        edges.push({ source: proj.renderWorkspaceId, target: workspaceNodeId, label: 'contains workspace' });
        edges.push({ source: proj.id, target: workspaceNodeId, label: 'deploys to' });
      } else {
        edges.push({ source: proj.id, target: proj.renderWorkspaceId, label: 'uses Render connection' });
      }
    }
  }

  for (const sess of sessions) {
    nodes.push({ id: sess.id, label: `Browser: ${sess.sessionName}`, type: 'browser', status: sess.status });
    if (sess.providerAccountId) {
      edges.push({ source: sess.providerAccountId, target: sess.id, label: 'signed into' });
    }
  }

  for (const k of keys) {
    nodes.push({ id: k.id, label: `Gateway: ${k.keyName}`, type: 'gateway', status: k.status });
  }

  res.json({ success: true, nodes, edges });
});

/**
 * 10. Safe ZIP Upload Analysis
 */
apiRouter.post('/upload-zip', async (req: Request, res: Response) => {
  try {
    const maxUpload = 50 * 1024 * 1024;
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > maxUpload) return res.status(413).json({ success:false, message:'ZIP exceeds the 50 MB upload limit.' });
    const chunks: Buffer[] = [];
    let received = 0;
    req.on('data', (c) => { received += Buffer.byteLength(c); if (received > maxUpload) req.destroy(new Error('ZIP exceeds the 50 MB upload limit.')); else chunks.push(c); });
    req.on('end', async () => {
      try {
        const fullBuffer = Buffer.concat(chunks);
        if (fullBuffer.length === 0) {
          return res.status(400).json({ success: false, message: 'Empty upload buffer' });
        }
        const result = await analyzeZipBuffer(fullBuffer);
        const uploadId = `upl_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const uploadDir = path.resolve(process.cwd(), 'data', 'uploads');
        fs.mkdirSync(uploadDir, { recursive: true });
        const archivePath = path.join(uploadDir, `${uploadId}.zip`);
        fs.writeFileSync(archivePath, fullBuffer);
        res.json({ success: true, uploadId, analysis: result, storedBytes: fullBuffer.length });
      } catch (err: any) {
        res.status(400).json({ success: false, message: err.message });
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

apiRouter.delete('/uploads/:uploadId', (req: Request, res: Response) => {
  const uploadId = String(req.params.uploadId);
  if (!/^upl_[a-zA-Z0-9_]+$/.test(uploadId)) return res.status(400).json({ success: false, message: 'Invalid upload ID' });
  const archivePath = path.resolve(process.cwd(), 'data', 'uploads', `${uploadId}.zip`);
  try { fs.unlinkSync(archivePath); } catch {}
  res.json({ success: true });
});

/**
 * 11. System Self-Test & Diagnostics
 */
apiRouter.get('/system/diagnostics', async (_req: Request, res: Response) => {
  const connections = db.getConnections();
  const vaultConfigured = Boolean(process.env.ENCRYPTION_MASTER_KEY);
  const browserSecretConfigured = Boolean(process.env.BROWSER_AGENT_SHARED_SECRET);
  const diagnostics = {
    database: { ...(await db.health()), type: 'postgresql', location: 'Render PostgreSQL / DATABASE_URL', persistent: true },
    encryptionVault: { status: vaultConfigured ? 'configured' : 'not_configured', algorithm: 'AES-256-GCM', masterKeyConfigured: vaultConfigured },
    agent: { status: 'not_configured', name: 'Own AI Brain', mode: 'user-owned / self-hosted', externalAiDependency: false, chatEnabled: false },
    providers: Object.fromEntries(getAllSupportedProviders().map((provider) => [provider, { connected: connections.filter((c) => c.provider === provider).length }])),
    browserAgent: {
      configuredSecret: browserSecretConfigured,
      activeSessions: db.getBrowserSessions().map((session) => ({ id: session.id, status: session.status, agentOnline: browserManager.isAgentConnected(session.id) })),
    },
    gateway: { totalKeys: db.getGatewayKeys().length, activeKeys: db.getGatewayKeys().filter((k) => k.status === 'active').length },
    costPolicy: db.getSettings().costPolicy,
  };
  res.json({ success: true, diagnostics });
});

apiRouter.get('/system/settings', (_req: Request, res: Response) => {
  const settings = db.getSettings();
  res.json({ success: true, settings: { ...settings, browserAgentSharedSecretConfigured: Boolean(process.env.BROWSER_AGENT_SHARED_SECRET) } });
});

apiRouter.put('/system/settings', (req: Request, res: Response) => {
  const allowedKeys = new Set(['costPolicy', 'autoFix', 'retentionDays', 'executionApprovalMode']);
  const safeUpdates: Record<string, any> = {};
  for (const [key, value] of Object.entries(req.body || {})) {
    if (allowedKeys.has(key)) safeUpdates[key] = value;
  }
  if (safeUpdates.costPolicy && !['free-only', 'ask-before-paid', 'allow-paid'].includes(String(safeUpdates.costPolicy))) {
    return res.status(400).json({ success: false, message: 'Invalid cost policy.' });
  }
  if (safeUpdates.executionApprovalMode && !['auto_safe', 'ask_all', 'ask_dangerous'].includes(String(safeUpdates.executionApprovalMode))) {
    return res.status(400).json({ success: false, message: 'Invalid execution approval mode.' });
  }
  if ('retentionDays' in safeUpdates) safeUpdates.retentionDays = Math.max(1, Math.min(3650, Number(safeUpdates.retentionDays) || 90));
  if ('autoFix' in safeUpdates) safeUpdates.autoFix = Boolean(safeUpdates.autoFix);
  const updated = db.updateSettings(safeUpdates);
  res.json({ success: true, settings: { ...updated, browserAgentSharedSecretConfigured: Boolean(process.env.BROWSER_AGENT_SHARED_SECRET) } });
});
