import crypto from 'node:crypto';

function getMasterKey() {
  const raw = process.env.ENCRYPTION_MASTER_KEY?.trim();
  if (!raw) throw new Error('ENCRYPTION_MASTER_KEY is not configured. Configure the vault secret before storing credentials.');
  return crypto.createHash('sha256').update(raw).digest();
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return '';
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decryptSecret(ciphertext: string): string {
  if (!ciphertext) return '';
  const parts = ciphertext.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted payload format');
  const [ivHex, authTagHex, encryptedHex] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', getMasterKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function createTokenFingerprint(token: string): string {
  return crypto.createHmac('sha256', getMasterKey()).update(token.trim()).digest('hex');
}

export function getSecretLast4(token: string): string {
  const trimmed = token.trim();
  return trimmed.length <= 4 ? '****' : trimmed.slice(-4);
}

export function hashGatewayKey(rawKey: string): string {
  const signing = process.env.GATEWAY_SIGNING_SECRET?.trim();
  if (!signing) throw new Error('GATEWAY_SIGNING_SECRET is not configured.');
  return crypto.createHmac('sha256', signing).update(rawKey.trim()).digest('hex');
}

export function hashBrowserPairingCode(code: string): string {
  const signing = process.env.BROWSER_AGENT_SHARED_SECRET?.trim();
  if (!signing) throw new Error('BROWSER_AGENT_SHARED_SECRET is not configured.');
  return crypto.createHmac('sha256', signing).update(code.trim()).digest('hex');
}

export function redactSecrets(data: any): any {
  if (typeof data === 'string') {
    return data
      .replace(/ghp_[a-zA-Z0-9]{30,}/g, 'ghp_[REDACTED]')
      .replace(/github_pat_[a-zA-Z0-9_]{30,}/g, 'github_pat_[REDACTED]')
      .replace(/rnd_[a-zA-Z0-9]{20,}/g, 'rnd_[REDACTED]')
      .replace(/vcp_[a-zA-Z0-9_-]{20,}/g, 'vcp_[REDACTED]')
      .replace(/nfp_[a-zA-Z0-9_-]{20,}/g, 'nfp_[REDACTED]')
      .replace(/gw_[a-zA-Z0-9]{24,}/g, 'gw_[REDACTED]')
      .replace(/Bearer\s+[a-zA-Z0-9_\-\.]{15,}/gi, 'Bearer [REDACTED]')
      .replace(/(token|secret|password|key)=([a-zA-Z0-9_\-\.]+)/gi, '$1=[REDACTED]');
  }
  if (Array.isArray(data)) return data.map(redactSecrets);
  if (data && typeof data === 'object') {
    const out: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      const lower = key.toLowerCase();
      if (lower.includes('secret') || lower.includes('token') || lower.includes('password') || lower.includes('credential') || lower === 'authorization' || lower.includes('privatekey')) {
        out[key] = typeof value === 'string' && value ? `[REDACTED-${getSecretLast4(value)}]` : '[REDACTED]';
      } else out[key] = redactSecrets(value);
    }
    return out;
  }
  return data;
}
