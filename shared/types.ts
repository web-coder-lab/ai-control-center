export type ProviderType = 'github' | 'render' | 'cloudflare' | 'vercel' | 'netlify' | 'supabase' | 'digitalocean' | 'gitdb';

export type TaskStatus =
  | 'queued'
  | 'planning'
  | 'waiting_for_input'
  | 'waiting_for_approval'
  | 'executing'
  | 'waiting_for_human'
  | 'retrying'
  | 'failed'
  | 'completed'
  | 'cancelled'
  | 'blocked';

export type CostPolicy = 'free-only' | 'ask-before-paid' | 'paid-allowed';

export interface ProviderConnection {
  id: string;
  provider: ProviderType;
  accountName: string;
  label?: string;
  purpose?: string;
  description?: string;
  howToUse?: string;
  username?: string;
  avatarUrl?: string;
  accountId?: string;
  status: 'connected' | 'valid' | 'invalid' | 'expired' | 'revoked' | 'rate_limited' | 'not_configured';
  permissions: string[];
  rateLimit?: {
    limit: number;
    remaining: number;
    resetAt?: string;
  };
  lastCheckedAt?: string;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
  secretFingerprint: string;
  tokenLast4: string;
  metadata?: Record<string, any>;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  projectType?: 'node_express' | 'react_vite' | 'nextjs' | 'static' | 'docker' | 'unknown';
  githubAccountId?: string;
  repoOwner?: string;
  repoName?: string;
  branch: string;
  // Connection ID for the Render API credential.
  renderWorkspaceId?: string;
  // Actual Render workspace/owner ID returned by the Render API. This is distinct from the API-credential connection ID.
  renderWorkspaceOwnerId?: string;
  renderWorkspaceName?: string;
  renderServiceId?: string;
  renderServiceName?: string;
  domain?: string;
  buildCommand?: string;
  startCommand?: string;
  archivePath?: string;
  uploadId?: string;
  envVarNames: string[];
  lastDeploymentAt?: string;
  autoFix: boolean;
  status: 'active' | 'deploying' | 'failed' | 'idle';
  createdAt: string;
  updatedAt: string;
}

export interface Deployment {
  id: string;
  projectId: string;
  projectName: string;
  provider: 'render' | 'github';
  accountId: string;
  renderWorkspaceOwnerId?: string;
  serviceId?: string;
  deploymentId: string;
  commitHash?: string;
  commitMessage?: string;
  status: 'queued' | 'building' | 'live' | 'failed' | 'cancelled';
  buildLogs: string[];
  durationMs?: number;
  url?: string;
  errorDiagnosis?: {
    category: string;
    whatHappened: string;
    whyItHappened: string;
    evidence: string;
    suggestedFix: string;
    riskLevel: 'low' | 'medium' | 'high';
  };
  createdAt: string;
  updatedAt: string;
}

export interface GatewayKey {
  id: string;
  keyName: string;
  keyPrefix: string;
  keyLast4: string;
  description?: string;
  status: 'active' | 'disabled' | 'revoked' | 'expired';
  rateLimit: number; // requests per minute
  allowedProviders: string[];
  allowedAccounts: string[];
  allowedBrowserSessions: string[];
  expiresAt?: string;
  createdAt: string;
  lastUsedAt?: string;
  permissionVersion: number;
  handshakeAcceptedAt?: string;
  capabilities: Record<string, boolean>;
}

export interface BrowserSession {
  id: string;
  sessionName: string;
  providerAccountId?: string;
  profileName: string;
  status: 'connected' | 'disconnected' | 'navigating' | 'waiting_for_human' | 'error';
  currentUrl?: string;
  currentTitle?: string;
  activeTab?: string;
  lastActivityAt?: string;
  waitingHuman: boolean;
  handoffReason?: string;
  screenshotBase64?: string;
  connectedAt?: string;
  pairingCodeHash?: string;
  pairingExpiresAt?: string;
}

export interface TaskStep {
  id: string;
  taskId: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  timestamp: string;
  details?: string;
}

export interface Task {
  id: string;
  agent: string;
  request: string;
  plan: string[];
  status: TaskStatus;
  currentStep: number;
  totalSteps: number;
  steps: TaskStep[];
  error?: string;
  result?: any;
  gatewayKeyId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityLog {
  id: string;
  timestamp: string;
  requestId: string;
  actor: string;
  agentId?: string;
  gatewayKeyId?: string;
  provider?: string;
  account?: string;
  operation: string;
  target?: string;
  capability?: string;
  status: 'success' | 'failed' | 'blocked' | 'waiting_human';
  durationMs: number;
  errorCategory?: string;
  safeErrorMessage?: string;
  humanApproval?: boolean;
  browserSessionId?: string;
  deploymentId?: string;
}

export interface SecurityEvent {
  id: string;
  timestamp: string;
  eventType: string;
  actor: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  details: string;
  resolved: boolean;
}

export interface TokenRequest {
  id: string;
  name: string;
  provider: ProviderType;
  account: string;
  requestedBy: string;
  description: string;
  howToUse: string;
  requestedPermissions: string[];
  encryptedToken: string;
  tokenFingerprint: string;
  tokenLast4?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

export interface DomainResource {
  id: string;
  domainName: string;
  provider: string;
  zoneId?: string;
  status: 'active' | 'pending' | 'error';
  sslStatus?: 'active' | 'pending' | 'expired';
  records: Array<{
    type: string;
    name: string;
    content: string;
    ttl?: number;
    proxied?: boolean;
  }>;
  checkedAt: string;
}

export interface FreeServiceCheck {
  id: string;
  provider: string;
  serviceName: string;
  isFree: boolean;
  sourceUrl?: string;
  notes: string;
  checkedAt: string;
}

export interface ResourceGraphNode {
  id: string;
  label: string;
  type: 'account' | 'repo' | 'service' | 'domain' | 'browser' | 'gateway' | 'project' | 'workspace';
  status?: string;
  metadata?: Record<string, any>;
}

export interface ResourceGraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}
