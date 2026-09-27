import { db } from '../database/db.js';
import { decryptSecret } from '../security/vault.js';
import { getProviderAdapter } from '../providers/index.js';
import { renderWorkspaceById, renderWorkspaceOwns } from '../providers/render/workspace.js';

export interface RelationshipVerificationResult {
  valid: boolean;
  mismatch: boolean;
  githubAccount?: any;
  renderWorkspace?: any;
  renderService?: any;
  reason?: string;
  details?: Record<string, any>;
}

export async function verifyGitHubRenderRelationship(
  githubAccountId: string,
  repoOwner: string,
  repoName: string,
  renderWorkspaceId?: string,
  renderServiceId?: string,
  renderWorkspaceOwnerId?: string
): Promise<RelationshipVerificationResult> {
  const ghConn = db.getConnectionById(githubAccountId);
  if (!ghConn) return { valid: false, mismatch: false, reason: `GitHub Account (${githubAccountId}) is not connected.` };
  if (ghConn.status === 'invalid' || ghConn.status === 'revoked' || ghConn.status === 'expired') {
    return { valid: false, mismatch: false, reason: `GitHub connection "${ghConn.accountName}" is ${ghConn.status}.` };
  }

  const ghSecret = decryptSecret(db.getEncryptedSecret(ghConn.id) || '');
  const github = getProviderAdapter('github');
  let repo: any;
  try {
    repo = await github.getResource(ghSecret, 'repository', `${repoOwner}/${repoName}`);
  } catch {
    return {
      valid: false,
      mismatch: false,
      githubAccount: { id: ghConn.id, username: ghConn.username, name: ghConn.accountName },
      reason: `GitHub repository ${repoOwner}/${repoName} is not accessible with ${ghConn.accountName}.`,
    };
  }

  if (repo?.owner?.login && ghConn.username && repo.owner.login.toLowerCase() !== ghConn.username.toLowerCase()) {
    return {
      valid: false,
      mismatch: true,
      githubAccount: { id: ghConn.id, username: ghConn.username, name: ghConn.accountName },
      reason: `Repository owner ${repo.owner.login} does not match selected GitHub account ${ghConn.username}.`,
    };
  }

  if (!renderWorkspaceId) {
    return { valid: true, mismatch: false, githubAccount: { id: ghConn.id, username: ghConn.username, name: ghConn.accountName } };
  }

  const renderConn = db.getConnectionById(renderWorkspaceId);
  if (!renderConn) return { valid: false, mismatch: false, githubAccount: { id: ghConn.id, username: ghConn.username }, reason: `Render workspace connection (${renderWorkspaceId}) is not connected.` };

  const renderSecret = decryptSecret(db.getEncryptedSecret(renderConn.id) || '');
  const render = getProviderAdapter('render');
  const selectedWorkspace = renderWorkspaceById(renderConn, renderWorkspaceOwnerId);
  if (renderWorkspaceOwnerId && !renderWorkspaceOwns(renderConn, renderWorkspaceOwnerId)) return { valid: false, mismatch: true, githubAccount: { id: ghConn.id, username: ghConn.username, name: ghConn.accountName }, renderWorkspace: { id: selectedWorkspace?.id || renderConn.id, name: selectedWorkspace?.name || renderConn.accountName }, reason: `Render workspace ${renderWorkspaceOwnerId} is not available to the selected Render API key.` };
  if (!renderWorkspaceOwnerId && Array.isArray(renderConn.metadata?.workspaces) && renderConn.metadata.workspaces.length > 1) return { valid: false, mismatch: false, githubAccount: { id: ghConn.id, username: ghConn.username, name: ghConn.accountName }, renderWorkspace: { id: selectedWorkspace?.id || renderConn.id, name: selectedWorkspace?.name || renderConn.accountName }, reason: 'Multiple Render workspaces are available; select the exact workspace before deployment.' };
  let service: any = undefined;
  if (renderServiceId) {
    try { service = await render.getResource(renderSecret, 'service', renderServiceId); }
    catch { return { valid: false, mismatch: true, githubAccount: { id: ghConn.id, username: ghConn.username }, renderWorkspace: { id: selectedWorkspace?.id || renderConn.id, name: selectedWorkspace?.name || renderConn.accountName }, reason: `Render service ${renderServiceId} is not accessible in ${renderConn.accountName}.` }; }
    const ownerId = service?.ownerId || service?.owner_id || service?.owner?.id || service?.service?.ownerId || service?.service?.owner_id;
    if (ownerId && renderWorkspaceOwnerId && String(ownerId) !== String(renderWorkspaceOwnerId)) {
      return { valid: false, mismatch: true, githubAccount: { id: ghConn.id, username: ghConn.username }, renderWorkspace: { id: selectedWorkspace?.id || renderConn.id, name: selectedWorkspace?.name || renderConn.accountName }, renderService: { id: renderServiceId, ownerId }, reason: `Render service ${renderServiceId} belongs to another workspace.` };
    }
    const linkedRepo = service?.repo || service?.service?.repo || service?.serviceDetails?.repo;
    if (linkedRepo) {
      const expected = `github.com/${repoOwner}/${repoName}`.toLowerCase().replace(/^https?:\/\//, '').replace(/\.git$/, '');
      const actual = String(linkedRepo).toLowerCase().replace(/^https?:\/\//, '').replace(/\.git$/, '').replace(/^git@github.com:/, 'github.com/');
      if (!actual.includes(expected)) {
        return {
          valid: false,
          mismatch: true,
          githubAccount: { id: ghConn.id, username: ghConn.username, name: ghConn.accountName },
          renderWorkspace: { id: selectedWorkspace?.id || renderConn.id, name: selectedWorkspace?.name || renderConn.accountName },
          renderService: { id: renderServiceId, repo: linkedRepo },
          reason: `Render service is connected to ${linkedRepo}, not ${repoOwner}/${repoName}.`,
          details: { expectedRepository: `${repoOwner}/${repoName}`, connectedRepository: linkedRepo },
        };
      }
    }
  }

  return {
    valid: true,
    mismatch: false,
    githubAccount: { id: ghConn.id, username: ghConn.username, name: ghConn.accountName },
    renderWorkspace: { id: selectedWorkspace?.id || renderConn.id, name: selectedWorkspace?.name || renderConn.accountName },
    renderService: service ? { id: renderServiceId, name: service.name } : undefined,
  };
}

export function classifyDeploymentLogs(logs: string[]): {
  category: string;
  whatHappened: string;
  whyItHappened: string;
  evidence: string;
  suggestedFix: string;
  riskLevel: 'low' | 'medium' | 'high';
} {
  const fullLog = logs.join('\n');
  if (fullLog.includes('MODULE_NOT_FOUND') || fullLog.includes('Cannot find module') || fullLog.includes('npm ERR! code ENOENT')) {
    const match = fullLog.match(/Cannot find module ['"]([^'"]+)['"]/);
    const mod = match ? match[1] : 'required package';
    return { category: 'missing_dependency', whatHappened: `Failed to find module: ${mod}`, whyItHappened: `The code imports "${mod}" but it is not available in the installed dependency tree.`, evidence: match ? match[0] : 'Module-not-found error in provider output.', suggestedFix: `Verify package.json and install the missing dependency before redeploying.`, riskLevel: 'low' };
  }
  if (fullLog.includes('SyntaxError') || /error TS\d+/.test(fullLog)) {
    const match = fullLog.match(/(error TS\d+:[^\n]+)/);
    return { category: 'syntax_or_type_error', whatHappened: 'Build stopped on a syntax or TypeScript error.', whyItHappened: 'The provider compiler reported invalid source or types.', evidence: match ? match[1] : 'TypeScript or syntax error found in logs.', suggestedFix: 'Inspect the reported file and line, fix it, commit the change, and redeploy.', riskLevel: 'medium' };
  }
  if (fullLog.includes('ELIFECYCLE') || fullLog.includes('missing script: build')) {
    return { category: 'build_command_failure', whatHappened: 'The configured build command failed or the script was missing.', whyItHappened: 'The provider could not execute the requested build step successfully.', evidence: 'npm lifecycle/build-script error in provider output.', suggestedFix: 'Verify package.json scripts and the configured Render build command.', riskLevel: 'low' };
  }
  if (fullLog.includes('EADDRINUSE') || /listen.*port|PORT/.test(fullLog)) {
    return { category: 'port_binding_issue', whatHappened: 'The service could not bind its network port.', whyItHappened: 'The process may be using a fixed port instead of Render’s assigned PORT.', evidence: 'Port binding message detected in logs.', suggestedFix: 'Use process.env.PORT in the application server.', riskLevel: 'low' };
  }
  if (fullLog.includes('ETIMEDOUT') || /timed? out/i.test(fullLog)) {
    return { category: 'timeout', whatHappened: 'The operation timed out.', whyItHappened: 'The provider or application did not finish within the available time window.', evidence: 'Timeout message found in logs.', suggestedFix: 'Inspect dependency/build duration and external network calls.', riskLevel: 'medium' };
  }
  return { category: 'unknown_build_error', whatHappened: 'The provider reported a failed deployment.', whyItHappened: 'The available logs do not identify a more specific cause.', evidence: logs.slice(-8).join('; '), suggestedFix: 'Review the latest provider logs and verify configuration before changing source code.', riskLevel: 'medium' };
}
