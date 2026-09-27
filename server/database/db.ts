import crypto from 'node:crypto';
import { Pool } from 'pg';
import { broadcastEvent } from '../realtime/events.js';
import type {
  ProviderConnection,
  Project,
  Deployment,
  GatewayKey,
  BrowserSession,
  Task,
  TaskStep,
  ActivityLog,
  SecurityEvent,
  TokenRequest,
  DomainResource,
  FreeServiceCheck,
} from '../../shared/types.js';

interface DatabaseSchema {
  version: number;
  users: Array<{ id: string; username: string; passwordHash: string; createdAt: string }>;
  provider_connections: ProviderConnection[];
  provider_secrets: Array<{ id: string; connectionId: string; encryptedSecret: string; fingerprint: string }>;
  projects: Project[];
  deployments: Deployment[];
  gateway_keys: GatewayKey[];
  browser_sessions: BrowserSession[];
  tasks: Task[];
  task_steps: TaskStep[];
  activity_logs: ActivityLog[];
  security_events: SecurityEvent[];
  token_requests: TokenRequest[];
  domains: DomainResource[];
  free_service_checks: FreeServiceCheck[];
  settings: Record<string, any>;
}

const INITIAL_SCHEMA: DatabaseSchema = {
  version: 2,
  users: [],
  provider_connections: [],
  provider_secrets: [],
  projects: [],
  deployments: [],
  gateway_keys: [],
  browser_sessions: [],
  tasks: [],
  task_steps: [],
  activity_logs: [],
  security_events: [],
  token_requests: [],
  domains: [],
  free_service_checks: [],
  settings: {
    costPolicy: 'ask-before-paid',
    autoFix: false,
    retentionDays: 90,
    executionApprovalMode: 'ask_dangerous',
  },
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * PostgreSQL-backed application state.
 *
 * The app keeps a small in-memory working copy for fast synchronous callers,
 * while PostgreSQL is the only durable source of truth. No local JSON database
 * is used in production or development.
 */
class Database {
  private data: DatabaseSchema = clone(INITIAL_SCHEMA);
  private readonly pool: Pool;
  private writeQueue: Promise<void> = Promise.resolve();
  private initialized = false;

  constructor() {
    const connectionString = process.env.DATABASE_URL?.trim();
    if (!connectionString) {
      throw new Error('DATABASE_URL is required. AI Control Center uses PostgreSQL for persistent runtime state.');
    }

    this.pool = new Pool({
      connectionString,
      max: Number(process.env.DB_POOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: /sslmode=require/i.test(connectionString) ? { rejectUnauthorized: false } : undefined,
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.pool.query(`
      create table if not exists control_center_state (
        id integer primary key check (id = 1),
        version integer not null default 1,
        state jsonb not null,
        updated_at timestamptz not null default now()
      )
    `);
    const result = await this.pool.query<{ state: DatabaseSchema }>('select state from control_center_state where id = 1');
    if (result.rows[0]?.state) {
      const parsed = result.rows[0].state;
      this.data = {
        ...clone(INITIAL_SCHEMA),
        ...parsed,
        settings: { ...INITIAL_SCHEMA.settings, ...(parsed.settings || {}) },
      };
    } else {
      await this.pool.query(
        `insert into control_center_state (id, version, state) values (1, $1, $2::jsonb)`,
        [this.data.version, JSON.stringify(this.data)],
      );
    }
    this.initialized = true;
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  async close(): Promise<void> {
    await this.flush();
    await this.pool.end();
  }

  async health(): Promise<{ healthy: boolean; latencyMs: number; message: string }> {
    const started = Date.now();
    try {
      await this.pool.query('select 1');
      return { healthy: true, latencyMs: Date.now() - started, message: 'PostgreSQL connection is healthy.' };
    } catch (error: any) {
      return { healthy: false, latencyMs: Date.now() - started, message: error?.message || 'PostgreSQL health check failed.' };
    }
  }

  private persist(): void {
    const snapshot = clone(this.data);
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        await this.pool.query(
          `update control_center_state set version = $1, state = $2::jsonb, updated_at = now() where id = 1`,
          [snapshot.version, JSON.stringify(snapshot)],
        );
      })
      .catch((err) => {
        console.error('[DB] PostgreSQL persistence failed:', err);
      });
  }

  // --- SETTINGS ---
  getSettings() {
    return { ...this.data.settings };
  }

  updateSettings(updates: Partial<DatabaseSchema['settings']>) {
    this.data.settings = { ...this.data.settings, ...updates };
    this.persist();
    return this.data.settings;
  }

  // --- PROVIDER CONNECTIONS ---
  getConnections(provider?: string): ProviderConnection[] {
    if (provider) return this.data.provider_connections.filter((c) => c.provider === provider);
    return [...this.data.provider_connections];
  }

  getConnectionById(id: string): ProviderConnection | undefined {
    return this.data.provider_connections.find((c) => c.id === id);
  }

  findDuplicateConnection(provider: string, fingerprint: string): ProviderConnection | undefined {
    return this.data.provider_connections.find((c) => c.provider === provider && c.secretFingerprint === fingerprint);
  }

  saveConnection(connection: ProviderConnection, encryptedSecret: string): ProviderConnection {
    const existingIndex = this.data.provider_connections.findIndex((c) => c.id === connection.id);
    if (existingIndex >= 0) this.data.provider_connections[existingIndex] = connection;
    else this.data.provider_connections.push(connection);

    const secretIndex = this.data.provider_secrets.findIndex((s) => s.connectionId === connection.id);
    const secretRecord = {
      id: secretIndex >= 0 ? this.data.provider_secrets[secretIndex].id : `sec_${crypto.randomUUID()}`,
      connectionId: connection.id,
      encryptedSecret,
      fingerprint: connection.secretFingerprint,
    };
    if (secretIndex >= 0) this.data.provider_secrets[secretIndex] = secretRecord;
    else this.data.provider_secrets.push(secretRecord);

    this.persist();
    broadcastEvent({ type: 'account.updated', data: { id: connection.id, provider: connection.provider, status: connection.status, accountName: connection.accountName } });
    return connection;
  }

  getEncryptedSecret(connectionId: string): string | null {
    return this.data.provider_secrets.find((s) => s.connectionId === connectionId)?.encryptedSecret || null;
  }

  deleteConnection(id: string): boolean {
    const initialLen = this.data.provider_connections.length;
    this.data.provider_connections = this.data.provider_connections.filter((c) => c.id !== id);
    this.data.provider_secrets = this.data.provider_secrets.filter((s) => s.connectionId !== id);
    if (this.data.provider_connections.length !== initialLen) {
      this.persist();
      return true;
    }
    return false;
  }

  // --- PROJECTS ---
  getProjects(): Project[] { return [...this.data.projects]; }
  getProjectById(id: string): Project | undefined { return this.data.projects.find((p) => p.id === id); }
  saveProject(project: Project): Project {
    const idx = this.data.projects.findIndex((p) => p.id === project.id);
    if (idx >= 0) this.data.projects[idx] = project; else this.data.projects.push(project);
    this.persist();
    broadcastEvent({ type: 'project.updated', data: project });
    return project;
  }
  deleteProject(id: string): boolean {
    const n = this.data.projects.length;
    this.data.projects = this.data.projects.filter((p) => p.id !== id);
    if (this.data.projects.length !== n) { this.persist(); broadcastEvent({ type: 'project.deleted', id }); return true; }
    return false;
  }

  // --- DEPLOYMENTS ---
  getDeployments(projectId?: string): Deployment[] {
    const deps = projectId ? this.data.deployments.filter((d) => d.projectId === projectId) : [...this.data.deployments];
    return deps.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  getDeploymentById(id: string): Deployment | undefined { return this.data.deployments.find((d) => d.id === id); }
  saveDeployment(dep: Deployment): Deployment {
    const idx = this.data.deployments.findIndex((d) => d.id === dep.id);
    if (idx >= 0) this.data.deployments[idx] = dep; else this.data.deployments.unshift(dep);
    this.persist();
    broadcastEvent({ type: 'deployment.updated', data: dep });
    return dep;
  }

  // --- GATEWAY KEYS ---
  getGatewayKeys(): GatewayKey[] {
    return this.data.gateway_keys.map((k) => {
      const safe = { ...(k as any) };
      delete safe.keyHash;
      return safe as GatewayKey;
    });
  }
  getGatewayKeyById(id: string): GatewayKey | undefined { return this.data.gateway_keys.find((k) => k.id === id); }
  findGatewayKeyByHash(keyHash: string): GatewayKey | undefined { return this.data.gateway_keys.find((k) => (k as any).keyHash === keyHash); }
  saveGatewayKey(key: GatewayKey, keyHash?: string): GatewayKey {
    const idx = this.data.gateway_keys.findIndex((k) => k.id === key.id);
    const prevHash = idx >= 0 ? (this.data.gateway_keys[idx] as any).keyHash : undefined;
    this.data.gateway_keys[idx >= 0 ? idx : this.data.gateway_keys.length] = ({ ...key, keyHash: keyHash || prevHash } as any);
    this.persist();
    broadcastEvent({ type: 'gateway.updated', data: { id: key.id, status: key.status, permissionVersion: key.permissionVersion } });
    return key;
  }
  deleteGatewayKey(id: string): boolean {
    const n = this.data.gateway_keys.length;
    this.data.gateway_keys = this.data.gateway_keys.filter((k) => k.id !== id);
    if (this.data.gateway_keys.length !== n) { this.persist(); broadcastEvent({ type: 'gateway.deleted', id }); return true; }
    return false;
  }

  // --- BROWSER SESSIONS ---
  getBrowserSessions(): BrowserSession[] { return [...this.data.browser_sessions]; }
  getBrowserSessionById(id: string): BrowserSession | undefined { return this.data.browser_sessions.find((s) => s.id === id); }
  findBrowserSessionByPairingHash(pairingHash: string): BrowserSession | undefined {
    const now = Date.now();
    return this.data.browser_sessions.find((s) => s.pairingCodeHash === pairingHash && (!s.pairingExpiresAt || new Date(s.pairingExpiresAt).getTime() > now));
  }
  saveBrowserSession(session: BrowserSession): BrowserSession {
    const idx = this.data.browser_sessions.findIndex((s) => s.id === session.id);
    if (idx >= 0) this.data.browser_sessions[idx] = session; else this.data.browser_sessions.push(session);
    this.persist();
    broadcastEvent({ type: 'browser.updated', data: session });
    return session;
  }
  deleteBrowserSession(id: string): boolean {
    const n = this.data.browser_sessions.length;
    this.data.browser_sessions = this.data.browser_sessions.filter((s) => s.id !== id);
    if (this.data.browser_sessions.length !== n) { this.persist(); return true; }
    return false;
  }

  // --- TASKS ---
  getTasks(): Task[] { return [...this.data.tasks].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()); }
  getTaskById(id: string): Task | undefined { return this.data.tasks.find((t) => t.id === id); }
  saveTask(task: Task): Task {
    const idx = this.data.tasks.findIndex((t) => t.id === task.id);
    if (idx >= 0) this.data.tasks[idx] = task; else this.data.tasks.unshift(task);
    this.persist();
    broadcastEvent({ type: 'task.updated', data: task });
    return task;
  }

  // --- ACTIVITY LOGS ---
  getActivityLogs(filter?: { actor?: string; provider?: string; gatewayKeyId?: string; status?: string; limit?: number }): ActivityLog[] {
    let logs = [...this.data.activity_logs];
    if (filter?.actor) logs = logs.filter((l) => l.actor === filter.actor);
    if (filter?.provider) logs = logs.filter((l) => l.provider === filter.provider);
    if (filter?.gatewayKeyId) logs = logs.filter((l) => l.gatewayKeyId === filter.gatewayKeyId);
    if (filter?.status) logs = logs.filter((l) => l.status === filter.status);
    logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return filter?.limit ? logs.slice(0, filter.limit) : logs;
  }
  addActivityLog(log: ActivityLog): ActivityLog {
    this.data.activity_logs.unshift(log);
    if (this.data.activity_logs.length > 10000) this.data.activity_logs = this.data.activity_logs.slice(0, 10000);
    this.persist();
    broadcastEvent({ type: 'activity.created', data: log });
    return log;
  }

  // --- SECURITY EVENTS ---
  getSecurityEvents(): SecurityEvent[] { return [...this.data.security_events].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()); }
  addSecurityEvent(event: SecurityEvent): SecurityEvent {
    this.data.security_events.unshift(event);
    this.persist();
    broadcastEvent({ type: 'security.created', data: event });
    return event;
  }

  // --- TOKEN REQUESTS ---
  getTokenRequests(): TokenRequest[] { return [...this.data.token_requests].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()); }
  getTokenRequestById(id: string): TokenRequest | undefined { return this.data.token_requests.find((r) => r.id === id); }
  saveTokenRequest(request: TokenRequest): TokenRequest {
    const idx = this.data.token_requests.findIndex((r) => r.id === request.id);
    if (idx >= 0) this.data.token_requests[idx] = request; else this.data.token_requests.unshift(request);
    this.persist();
    return request;
  }

  // --- DOMAINS & DNS ---
  getDomains(): DomainResource[] { return [...this.data.domains]; }
  saveDomain(domain: DomainResource): DomainResource {
    const idx = this.data.domains.findIndex((d) => d.id === domain.id);
    if (idx >= 0) this.data.domains[idx] = domain; else this.data.domains.push(domain);
    this.persist();
    return domain;
  }

  // --- FREE SERVICE CHECKS ---
  getFreeServiceChecks(): FreeServiceCheck[] { return [...this.data.free_service_checks]; }
  addFreeServiceCheck(check: FreeServiceCheck): FreeServiceCheck {
    const idx = this.data.free_service_checks.findIndex((c) => c.provider === check.provider && c.serviceName === check.serviceName);
    if (idx >= 0) this.data.free_service_checks[idx] = check; else this.data.free_service_checks.push(check);
    this.persist();
    return check;
  }
}

export const db = new Database();
