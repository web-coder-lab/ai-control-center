import { chromium, type BrowserContext, type Page } from 'playwright';
import { WebSocket } from 'ws';
import path from 'node:path';
import fs from 'node:fs';

const CONTROL_CENTER_WS_URL = process.env.CONTROL_CENTER_WS_URL || 'ws://localhost:3000/ws/browser-agent';
const SESSION_ID = process.env.BROWSER_SESSION_ID?.trim();
const SHARED_SECRET = process.env.BROWSER_AGENT_SHARED_SECRET?.trim();
const PAIRING_CODE = process.env.BROWSER_PAIRING_CODE?.trim();
const USER_DATA_DIR = path.resolve(process.cwd(), '.profiles', SESSION_ID || 'unset');

if (!SESSION_ID) throw new Error('BROWSER_SESSION_ID is required.');
if (!SHARED_SECRET && !PAIRING_CODE) throw new Error('Set BROWSER_PAIRING_CODE for session pairing or BROWSER_AGENT_SHARED_SECRET for legacy pairing.');
fs.mkdirSync(USER_DATA_DIR, { recursive: true });

let ws: WebSocket | null = null;
let context: BrowserContext | null = null;
let activePage: Page | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;

const blockedActions = new Set(['download', 'upload', 'read_cookies', 'write_cookies', 'delete_cookies', 'read_passwords', 'read_storage', 'write_storage', 'grant_permission']);

async function ensureBrowser() {
  if (context) return context;
  context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    acceptDownloads: false,
    permissions: [],
    viewport: { width: 1440, height: 900 },
  });
  activePage = context.pages()[0] || await context.newPage();
  context.on('requestfailed', () => undefined);
  for (const page of context.pages()) { page.on('download', (download) => { void download.cancel().catch(() => undefined); }); }
  activePage.on('download', (download) => { void download.cancel().catch(() => undefined); });
  context.on('page', (page) => { activePage = page; page.on('download', (download) => { void download.cancel().catch(() => undefined); }); });
  return context;
}

function assertPublicWebUrl(raw: string) {
  const target = new URL(raw);
  if (!/^https?:$/.test(target.protocol)) throw new Error('Only HTTP(S) navigation is allowed.');
  if (target.username || target.password) throw new Error('URLs containing embedded credentials are blocked.');
  const host = target.hostname.toLowerCase();
  if (['localhost','127.0.0.1','::1','0.0.0.0'].includes(host) || host.endsWith('.localhost') ||
      /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
      /^169\.254\./.test(host) || /^100\.64\./.test(host) || /^fc[0-9a-f]{2}:/i.test(host) ||
      /^fd[0-9a-f]{2}:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host)) {
    throw new Error('Navigation to local/private/link-local network hosts is blocked.');
  }
  return target;
}

function send(payload: any) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload)); }

const HUMAN_VERIFICATION_PATTERNS = [
  /captcha/i,
  /re\s*captcha/i,
  /hcaptcha/i,
  /cloudflare turnstile/i,
  /verify you are human/i,
  /are you a human/i,
  /are you a robot/i,
  /security check/i,
  /unusual activity/i,
  /two[- ]factor/i,
  /2fa/i,
  /one[- ]time code/i,
  /verification code/i,
  /passkey/i,
  /security key/i,
  /confirm it'?s you/i,
];

async function detectHumanVerification(page: Page) {
  try {
    const bodyText = await page.locator('body').innerText({ timeout: 5000 });
    const title = await page.title().catch(() => '');
    const sample = `${title}
${bodyText.slice(0, 50000)}`;
    const matched = HUMAN_VERIFICATION_PATTERNS.find((pattern) => pattern.test(sample));
    return matched ? { humanRequired: true, humanReason: 'Human verification or security challenge detected on the current page.' } : { humanRequired: false };
  } catch {
    return { humanRequired: false };
  }
}

async function snapshot() {
  if (!activePage || !ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    const screenshot = await activePage.screenshot({ type: 'jpeg', quality: 55, fullPage: false });
    send({ type: 'snapshot', sessionId: SESSION_ID, url: activePage.url(), title: await activePage.title().catch(() => ''), screenshot: screenshot.toString('base64') });
  } catch { /* browser may be transitioning */ }
}

async function handleAction(action: string, params: any = {}) {
  if (blockedActions.has(action)) throw new Error(`Browser policy blocks ${action}.`);
  const browser = await ensureBrowser();
  const page = activePage || browser.pages()[0];
  if (!page) throw new Error('No active browser tab.');
  activePage = page;

  switch (action) {
    case 'navigate': {
      const target = assertPublicWebUrl(String(params.url));
      await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 });
      return { success: true, currentUrl: page.url(), currentTitle: await page.title().catch(() => ''), status: 'loaded' };
    }
    case 'back': { await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null); return { success:true, currentUrl:page.url(), currentTitle:await page.title().catch(()=>'' ) }; }
    case 'forward': { await page.goForward({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null); return { success:true, currentUrl:page.url(), currentTitle:await page.title().catch(()=>'' ) }; }
    case 'refresh': { await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }); return { success:true, currentUrl:page.url(), currentTitle:await page.title().catch(()=>'' ) }; }
    case 'open_tab': {
      const newPage = await browser.newPage();
      newPage.on('download', (download) => { void download.cancel().catch(() => undefined); });
      if (params.url) { const target = assertPublicWebUrl(String(params.url)); await newPage.goto(target.toString(), { waitUntil:'domcontentloaded', timeout:30000 }); }
      activePage = newPage;
      return { success:true, index: browser.pages().indexOf(newPage), currentUrl:newPage.url(), currentTitle:await newPage.title().catch(()=>'' ) };
    }
    case 'switch_tab': { const idx = Number(params.index); const pages=browser.pages(); if(!Number.isInteger(idx)||idx<0||idx>=pages.length) throw new Error('Invalid tab index.'); activePage=pages[idx]; await activePage.bringToFront(); return { success:true, index:idx, currentUrl:activePage.url(), currentTitle:await activePage.title().catch(()=>'' ) }; }
    case 'close_tab': { const idx = params.index === undefined ? browser.pages().indexOf(page) : Number(params.index); const pages=browser.pages(); if(pages.length<=1) throw new Error('Cannot close the last browser tab.'); if(!Number.isInteger(idx)||idx<0||idx>=pages.length) throw new Error('Invalid tab index.'); await pages[idx].close(); activePage=browser.pages()[Math.min(idx, browser.pages().length-1)]; return { success:true, tabs:browser.pages().length }; }
    case 'click': {
      if (!params.selector && !params.text) throw new Error('A selector or visible text is required.');
      if (params.selector) await page.locator(params.selector).first().click({ timeout: 15000 });
      else await page.getByText(String(params.text), { exact: false }).first().click({ timeout: 15000 });
      return { success: true, currentUrl: page.url(), currentTitle: await page.title().catch(() => ''), clicked: true };
    }
    case 'type': {
      if (!params.selector) throw new Error('A selector is required for typing.');
      await page.locator(params.selector).first().fill(String(params.text ?? ''), { timeout: 15000 });
      return { success: true, currentUrl: page.url(), currentTitle: await page.title().catch(() => ''), textEntered: true };
    }
    case 'copy': {
      if (!params.selector) throw new Error('A selector is required for copying visible text.');
      const text = await page.locator(params.selector).first().innerText({ timeout: 15000 });
      return { success: true, copied: true, text };
    }
    case 'paste': {
      if (!params.selector) throw new Error('A selector is required for paste.');
      await page.locator(params.selector).first().fill(String(params.text ?? ''), { timeout: 15000 });
      return { success: true, pasted: true };
    }
    case 'scroll': {
      await page.evaluate((y) => window.scrollBy(0, Number(y)), Number(params.y || 600));
      return { success: true, url: page.url() };
    }
    case 'tabs': {
      const pages = browser.pages();
      return { success: true, tabs: await Promise.all(pages.map(async (tab, index) => ({ index, url: tab.url(), title: await tab.title().catch(() => '') }))) };
    }
    case 'screenshot': {
      const screenshot = await page.screenshot({ type: 'jpeg', quality: 70 });
      return { success: true, screenshot: screenshot.toString('base64') };
    }
    case 'read_page': {
      const text = await page.locator('body').innerText({ timeout: 15000 });
      return { success: true, text: text.slice(0, 30000), url: page.url(), title: await page.title().catch(() => '') };
    }
    default:
      throw new Error(`Unsupported browser action: ${action}`);
  }
}

function connect() {
  const query = `sessionId=${encodeURIComponent(SESSION_ID!)}`;
  const wsUrl = `${CONTROL_CENTER_WS_URL}?${query}`;
  const headers = {
    ...(SHARED_SECRET ? { 'x-browser-agent-secret': SHARED_SECRET } : {}),
    ...(PAIRING_CODE ? { 'x-browser-agent-pairing-code': PAIRING_CODE } : {}),
  };
  ws = new WebSocket(wsUrl, { headers });
  ws.on('open', async () => { console.log('[Browser Agent] connected'); await ensureBrowser(); await snapshot(); });
  ws.on('message', async (data) => {
    try {
      const command = JSON.parse(data.toString());
      if (command.type) return;
      const result = await handleAction(command.action, command.params);
      const human = activePage ? await detectHumanVerification(activePage) : { humanRequired: false };
      const mergedResult = human.humanRequired ? { ...result, humanRequired: true, humanReason: human.humanReason } : result;
      send({ msgId: command.msgId, result: mergedResult, url: activePage?.url(), title: await activePage?.title().catch(() => '') });
      await snapshot();
    } catch (err: any) {
      let msgId: string | undefined;
      try { msgId = JSON.parse(data.toString())?.msgId; } catch {}
      send({ msgId, error: String(err.message || err) });
    }
  });
  ws.on('close', () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 4000);
  });
  ws.on('error', () => { /* close handler reconnects */ });
}

setInterval(snapshot, 2000);
connect();
