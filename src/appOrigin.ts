export const LIVE_ORIGIN = 'https://ai-control-center-5o39.onrender.com';
export function appOrigin() {
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return LIVE_ORIGIN;
}
