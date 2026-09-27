import { db } from '../database/db.js';
import type { BrowserSession } from '../../shared/types.js';
import { broadcastEvent } from '../realtime/events.js';

interface BrowserActionRequest {
  sessionId: string;
  action:
    | 'navigate'
    | 'click'
    | 'type'
    | 'copy'
    | 'paste'
    | 'scroll'
    | 'tabs'
    | 'screenshot'
    | 'read_page'
    | 'human_handoff'
    | 'back'
    | 'forward'
    | 'refresh'
    | 'open_tab'
    | 'switch_tab'
    | 'close_tab'
    // Sensitive actions
    | 'download'
    | 'upload'
    | 'read_cookies'
    | 'read_passwords'
    | 'write_cookies'
    | 'delete_cookies'
    | 'read_storage'
    | 'write_storage'
    | 'grant_permission';
  params?: Record<string, any>;
  gatewayKeyId?: string;
}

export class BrowserManager {
  private activeAgentSockets = new Map<string, any>();
  private liveScreenshots = new Map<string, string>();

  getLiveScreenshot(sessionId: string): string | undefined {
    return this.liveScreenshots.get(sessionId);
  }

  getSessionsForUi(): BrowserSession[] {
    return db.getBrowserSessions().map((session) => {
      const screenshotBase64 = this.liveScreenshots.get(session.id);
      return screenshotBase64 ? { ...session, screenshotBase64 } : session;
    });
  }

  registerAgentSocket(sessionId: string, socket: any) {
    this.activeAgentSockets.set(sessionId, socket);
    const snapshotHandler = (data: any) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed?.type !== 'snapshot') return;
        const current = db.getBrowserSessionById(sessionId);
        if (!current) return;
        if (parsed.url) current.currentUrl = parsed.url;
        if (parsed.title) current.currentTitle = parsed.title;
        if (parsed.screenshot) this.liveScreenshots.set(sessionId, parsed.screenshot);
        current.lastActivityAt = new Date().toISOString();
        // Do not persist high-frequency screenshots into the JSON store. Keep only transient live state in memory.
        const persisted = { ...current, screenshotBase64: undefined };
        db.saveBrowserSession(persisted);
        broadcastEvent({ type: 'browser.snapshot', data: { sessionId, url: parsed.url, title: parsed.title, screenshot: parsed.screenshot } });
      } catch {}
    };
    socket.on('message', snapshotHandler);
    socket.once('close', () => socket.off('message', snapshotHandler));
    const session = db.getBrowserSessionById(sessionId);
    if (session) {
      session.status = 'connected';
      session.connectedAt = new Date().toISOString();
      session.lastActivityAt = new Date().toISOString();
      db.saveBrowserSession(session);
    }
  }

  unregisterAgentSocket(sessionId: string) {
    this.activeAgentSockets.delete(sessionId);
    this.liveScreenshots.delete(sessionId);
    const session = db.getBrowserSessionById(sessionId);
    if (session) {
      session.status = 'disconnected';
      db.saveBrowserSession(session);
    }
  }

  isAgentConnected(sessionId: string): boolean {
    return this.activeAgentSockets.has(sessionId);
  }

  /**
   * Enforces backend browser policy before sending action to browser agent.
   */
  async executeAction(req: BrowserActionRequest): Promise<any> {
    const session = db.getBrowserSessionById(req.sessionId);
    if (!session) {
      throw new Error(`Browser session "${req.sessionId}" not found.`);
    }

    // 1. Strictly block sensitive capabilities unless explicit permission exists
    if (req.action === 'download') {
      db.addSecurityEvent({
        id: `sec_${Date.now()}`,
        timestamp: new Date().toISOString(),
        eventType: 'BROWSER_DOWNLOAD_BLOCKED',
        actor: req.gatewayKeyId || 'user',
        severity: 'high',
        details: 'Attempted browser download blocked by security policy (browser.download=false).',
        resolved: true,
      });
      throw new Error('Security Policy: Browser file downloads are strictly BLOCKED.');
    }

    if (req.action === 'upload') {
      db.addSecurityEvent({
        id: `sec_${Date.now()}`,
        timestamp: new Date().toISOString(),
        eventType: 'BROWSER_UPLOAD_BLOCKED',
        actor: req.gatewayKeyId || 'user',
        severity: 'high',
        details: 'Attempted browser file upload blocked by security policy.',
        resolved: true,
      });
      throw new Error('Security Policy: Browser file uploads are strictly BLOCKED.');
    }

    if (['read_cookies', 'write_cookies', 'delete_cookies', 'read_storage', 'write_storage', 'read_passwords', 'grant_permission'].includes(req.action)) {
      db.addSecurityEvent({
        id: `sec_${Date.now()}`,
        timestamp: new Date().toISOString(),
        eventType: 'BROWSER_SENSITIVE_ACCESS_BLOCKED',
        actor: req.gatewayKeyId || 'user',
        severity: 'critical',
        details: `Attempted browser sensitive action ${req.action} blocked.`,
        resolved: true,
      });
      throw new Error(`Security Policy: Browser action ${req.action} is strictly blocked.`);
    }

    // 2. Human handoff action
    if (req.action === 'human_handoff') {
      session.status = 'waiting_for_human';
      session.waitingHuman = true;
      session.handoffReason = req.params?.reason || 'CAPTCHA / 2FA verification required';
      session.lastActivityAt = new Date().toISOString();
      db.saveBrowserSession(session);

      db.addActivityLog({
        id: `log_${Date.now()}`,
        timestamp: new Date().toISOString(),
        requestId: `req_${Date.now()}`,
        actor: req.gatewayKeyId || 'Main AI',
        operation: 'browser.human_handoff',
        target: session.currentUrl || 'Browser Session',
        status: 'waiting_human',
        durationMs: 0,
        safeErrorMessage: session.handoffReason,
        humanApproval: true,
        browserSessionId: session.id,
      });

      return {
        status: 'waiting_for_human',
        reason: session.handoffReason,
        message: 'Automation paused. Browser is temporarily handed off to human for security verification.',
      };
    }

    // 3. Dispatch to agent socket if connected
    const socket = this.activeAgentSockets.get(req.sessionId);
    if (!socket || socket.readyState !== 1) {
      session.status = 'disconnected';
      db.saveBrowserSession(session);
      throw new Error('Browser Agent is currently offline. Start the companion /browser-agent process to connect live Chromium.');
    }

    // Send action through WebSocket to companion agent
    return new Promise((resolve, reject) => {
      const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const timeout = setTimeout(() => {
        socket.off('message', handleResponse);
        reject(new Error('Browser action timed out after 15 seconds.'));
      }, 15000);

      const handleResponse = (data: any) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.msgId === msgId) {
            clearTimeout(timeout);
            socket.off('message', handleResponse);
            if (parsed.error) {
              reject(new Error(parsed.error));
            } else {
              // Update session metadata
              if (parsed.url) session.currentUrl = parsed.url;
              if (parsed.title) session.currentTitle = parsed.title;
              if (parsed.screenshot) this.liveScreenshots.set(req.sessionId, parsed.screenshot);
              session.lastActivityAt = new Date().toISOString();
              const humanRequired = parsed.result?.humanRequired === true;
              if (humanRequired) {
                session.status = 'waiting_for_human';
                session.waitingHuman = true;
                session.handoffReason = parsed.result?.humanReason || 'Human verification is required on the current page.';
                db.addSecurityEvent({ id: `sec_${Date.now()}`, timestamp: new Date().toISOString(), eventType: 'BROWSER_HUMAN_HANDOFF_TRIGGERED', actor: req.gatewayKeyId || 'Main AI', severity: 'medium', details: `Browser automation paused for human verification in session ${req.sessionId}.`, resolved: false });
                db.addActivityLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), requestId: `req_${Date.now()}`, actor: req.gatewayKeyId || 'Main AI', operation: 'browser.auto_human_handoff', target: session.currentUrl || 'Browser Session', status: 'waiting_human', durationMs: 0, safeErrorMessage: session.handoffReason, browserSessionId: session.id });
              }
              const persisted = { ...session, screenshotBase64: undefined };
              db.saveBrowserSession(persisted);
              resolve(humanRequired ? { ...parsed.result, status: 'waiting_for_human', humanRequired: true } : parsed.result);
            }
          }
        } catch {
          // ignore parsing error from other messages
        }
      };

      socket.on('message', handleResponse);
      socket.send(
        JSON.stringify({
          msgId,
          action: req.action,
          params: req.params,
        })
      );
    });
  }

  resumeAfterHuman(sessionId: string) {
    const session = db.getBrowserSessionById(sessionId);
    if (!session) throw new Error('Session not found');
    session.waitingHuman = false;
    session.handoffReason = undefined;
    session.status = this.isAgentConnected(sessionId) ? 'connected' : 'disconnected';
    session.lastActivityAt = new Date().toISOString();
    db.saveBrowserSession(session);

    db.addActivityLog({
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      requestId: `req_${Date.now()}`,
      actor: 'Human User',
      operation: 'browser.resume_after_handoff',
      target: session.currentUrl || 'Browser Session',
      status: 'success',
      durationMs: 0,
      browserSessionId: session.id,
    });

    return session;
  }
}

export const browserManager = new BrowserManager();
