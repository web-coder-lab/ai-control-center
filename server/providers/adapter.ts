export interface ProviderIdentity {
  provider: string;
  accountId: string;
  accountName: string;
  username?: string;
  avatarUrl?: string;
  email?: string;
  organization?: string;
  scopes?: string[];
  metadata?: Record<string, any>;
  rateLimit?: {
    limit: number;
    remaining: number;
    resetAt?: string;
  };
}

export interface CredentialValidationResult {
  valid: boolean;
  identity?: ProviderIdentity;
  permissions?: string[];
  error?: string;
}

export interface HealthCheckResult {
  healthy: boolean;
  latencyMs: number;
  message: string;
  rateLimit?: {
    remaining: number;
    limit: number;
  };
}

export interface NormalizedError {
  code: string;
  message: string;
  safeDetails?: string;
  isTransient?: boolean;
}

export interface ProviderAdapter {
  readonly provider: string;

  getIdentity(secret: string): Promise<ProviderIdentity>;
  validateCredential(secret: string): Promise<CredentialValidationResult>;
  getCapabilities(): string[];
  listResources(secret: string, resourceType: string, options?: any): Promise<any[]>;
  getResource(secret: string, resourceType: string, resourceId: string): Promise<any>;
  performAction(secret: string, action: string, params: any): Promise<any>;
  healthCheck(secret: string): Promise<HealthCheckResult>;
  revoke(secret: string): Promise<boolean>;
  normalizeError(err: any): NormalizedError;
}
