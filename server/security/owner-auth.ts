import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

const COOKIE_NAME = 'acc_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const sessions = new Map<string, number>();
const loginAttempts = new Map<string, { count: number; windowStart: number }>();
const LOGIN_LIMIT = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function consumeLoginAttempt(ip: string) {
  const now = Date.now();
  const current = loginAttempts.get(ip);
  if (!current || now - current.windowStart > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (current.count >= LOGIN_LIMIT) return false;
  current.count += 1;
  loginAttempts.set(ip, current);
  return true;
}

function timingSafeStringEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function getCookie(req: Request, name: string) {
  const raw = req.headers.cookie || '';
  const pair = raw.split(';').map((v) => v.trim()).find((v) => v.startsWith(`${name}=`));
  if (!pair) return undefined;
  try { return decodeURIComponent(pair.slice(name.length + 1)); } catch { return undefined; }
}

function cleanupExpired() {
  const now = Date.now();
  for (const [token, expiresAt] of sessions) if (expiresAt <= now) sessions.delete(token);
}

export function ownerAuthConfigured() {
  return Boolean(process.env.OWNER_PASSWORD && process.env.OWNER_PASSWORD.length >= 12);
}

export function createOwnerSession(res: Response) {
  cleanupExpired();
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

export function destroyOwnerSession(req: Request, res: Response) {
  const token = getCookie(req, COOKIE_NAME);
  if (token) sessions.delete(token);
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/' });
}

export function isOwnerAuthenticated(req: Request) {
  cleanupExpired();
  const token = getCookie(req, COOKIE_NAME);
  if (!token) return false;
  const expiresAt = sessions.get(token);
  if (!expiresAt || expiresAt <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function authenticateOwnerPassword(password: unknown, ip = 'unknown') {
  if (!consumeLoginAttempt(ip)) return false;
  const expected = process.env.OWNER_PASSWORD || '';
  if (typeof password !== 'string' || !ownerAuthConfigured()) return false;
  return timingSafeStringEqual(password, expected);
}


export function isOwnerAuthenticatedFromHeaders(headers: Record<string, any>) {
  cleanupExpired();
  const raw = headers.cookie || headers.Cookie || '';
  const tokenPart = String(raw).split(';').map((v) => v.trim()).find((v) => v.startsWith(`${COOKIE_NAME}=`));
  if (!tokenPart) return false;
  let token = '';
  try { token = decodeURIComponent(tokenPart.slice(COOKIE_NAME.length + 1)); } catch { return false; }
  const expiresAt = sessions.get(token);
  if (!expiresAt || expiresAt <= Date.now()) { sessions.delete(token); return false; }
  return true;
}

export function requireOwnerAuth(req: Request, res: Response, next: NextFunction) {
  if (!ownerAuthConfigured()) {
    return res.status(503).json({
      success: false,
      code: 'OWNER_AUTH_NOT_CONFIGURED',
      message: 'Owner authentication is not configured. Set OWNER_PASSWORD to a strong secret before using the control center.',
    });
  }
  if (!isOwnerAuthenticated(req)) {
    return res.status(401).json({ success: false, code: 'OWNER_AUTH_REQUIRED', message: 'Sign in to the AI Control Center.' });
  }
  next();
}
