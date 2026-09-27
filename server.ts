import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import { WebSocketServer, WebSocket } from 'ws';
import { apiRouter } from './server/routes/api.router.js';
import { gatewayRouter } from './server/gateway/gateway.router.js';
import { browserManager } from './server/browser/browser.manager.js';
import { db } from './server/database/db.js';
import { isOwnerAuthenticatedFromHeaders } from './server/security/owner-auth.js';
import { hashBrowserPairingCode } from './server/security/vault.js';
import { broadcastEvent, registerRealtimeSocket, unregisterRealtimeSocket } from './server/realtime/events.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const PORT = parseInt(process.env.PORT || '3000', 10);

// Basic Security & Parsing Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Security Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  next();
});

// Health Endpoints (Requirement 115)
app.get('/health', (_req, res) => {
  const missing = ['DATABASE_URL', 'ENCRYPTION_MASTER_KEY', 'SESSION_SECRET', 'GATEWAY_SIGNING_SECRET', 'BROWSER_AGENT_SHARED_SECRET', 'OWNER_PASSWORD'].filter((name) => !process.env[name]);
  const status = missing.length ? 'degraded' : 'healthy';
  res.status(missing.length ? 503 : 200).json({ status, uptime: process.uptime(), database: 'postgresql', missingSecrets: missing, timestamp: new Date().toISOString() });
});

app.get('/ready', (_req, res) => {
  const missing = ['DATABASE_URL', 'ENCRYPTION_MASTER_KEY', 'SESSION_SECRET', 'GATEWAY_SIGNING_SECRET', 'BROWSER_AGENT_SHARED_SECRET', 'OWNER_PASSWORD'].filter((name) => !process.env[name]);
  if (missing.length) return res.status(503).json({ ready: false, missing, timestamp: new Date().toISOString() });
  res.json({ ready: true, timestamp: new Date().toISOString() });
});

app.get('/api/health', async (_req, res) => {
  const missing = ['DATABASE_URL', 'ENCRYPTION_MASTER_KEY', 'SESSION_SECRET', 'GATEWAY_SIGNING_SECRET', 'BROWSER_AGENT_SHARED_SECRET', 'OWNER_PASSWORD'].filter((name) => !process.env[name]);
  const ok = missing.length === 0;
  const database = await db.health();
  const healthy = ok && database.healthy;
  res.status(healthy ? 200 : 503).json({ status: healthy ? 'healthy' : 'degraded', database: { type: 'postgresql', ...database }, vault: ok ? 'configured' : 'not_configured', missingSecrets: missing, timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api', apiRouter);

// Secure External AI Gateway Routes
app.use('/v1', gatewayRouter);

// WebSocket Setup for Browser Agent & Real-time UI Stream
const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket, req) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const pathname = url.pathname;

  // 1. Browser Agent Connection (/ws/browser-agent)
  if (pathname === '/ws/browser-agent') {
    const sessionId = url.searchParams.get('sessionId');
    const suppliedSecret = req.headers['x-browser-agent-secret'];
    const suppliedPairing = req.headers['x-browser-agent-pairing-code'] || url.searchParams.get('pairingCode');
    const secret = Array.isArray(suppliedSecret) ? suppliedSecret[0] : suppliedSecret;
    const pairing = Array.isArray(suppliedPairing) ? suppliedPairing[0] : suppliedPairing;
    const expectedSecret = process.env.BROWSER_AGENT_SHARED_SECRET;
    const session = sessionId ? db.getBrowserSessionById(sessionId) : undefined;
    const legacyAuthorized = Boolean(sessionId && expectedSecret && secret && secret === expectedSecret);
    let pairingAuthorized = false;
    if (sessionId && pairing) {
      try {
        const pairingHash = hashBrowserPairingCode(String(pairing));
        pairingAuthorized = Boolean(session?.pairingCodeHash === pairingHash && (!session?.pairingExpiresAt || new Date(session.pairingExpiresAt).getTime() > Date.now()));
      } catch { pairingAuthorized = false; }
    }
    if (!sessionId || !session || (!legacyAuthorized && !pairingAuthorized)) { ws.close(4001, 'Unauthorized Browser Agent Pairing'); return; }
    if (pairingAuthorized && session) { session.connectedAt = new Date().toISOString(); db.saveBrowserSession(session); }
    browserManager.registerAgentSocket(sessionId, ws);
    ws.on('close', () => browserManager.unregisterAgentSocket(sessionId));
    return;
  }

  // 2. Real-time Dashboard Events (/ws/events)
  if (pathname === '/ws/events') {
    if (!isOwnerAuthenticatedFromHeaders(req.headers as any)) { ws.close(4003, 'Owner authentication required'); return; }
    registerRealtimeSocket(ws);
    ws.send(JSON.stringify({ type: 'INIT', message: 'Connected to AI Control Center real-time event stream.' }));
    ws.on('close', () => unregisterRealtimeSocket(ws));
  }
});

// Vite Middleware for Development / Static Hosting for Production
async function setupViteOrStatic() {
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false, // Disabled as per environment constraints
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }
}

db.initialize().then(() => setupViteOrStatic()).then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[AI Control Center] Server running at http://0.0.0.0:${PORT}`);
  });
}).catch((err) => {
  console.error('[AI Control Center] Startup failed:', err);
  process.exit(1);
});

const shutdown = async (signal: string) => {
  console.log(`[AI Control Center] ${signal} received; closing server and database.`);
  await db.close().catch((err) => console.error('[DB] Shutdown failed:', err));
  server.close(() => process.exit(0));
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
