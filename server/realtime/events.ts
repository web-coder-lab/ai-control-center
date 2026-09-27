import type { WebSocket } from 'ws';
const clients = new Set<WebSocket>();
export function registerRealtimeSocket(ws: WebSocket) { clients.add(ws); }
export function unregisterRealtimeSocket(ws: WebSocket) { clients.delete(ws); }
export function broadcastEvent(event: any) {
  const payload = JSON.stringify(event);
  for (const ws of clients) { if (ws.readyState === 1) ws.send(payload); }
}
