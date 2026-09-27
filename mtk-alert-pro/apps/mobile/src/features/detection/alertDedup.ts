/**
 * Local alert dedup — prevents realtime subscriber from double-ringing
 * when detectionManager already handled the same event.
 */

const recentLocalAlertKeys = new Map<string, number>();
const LOCAL_ALERT_DEDUP_MS = 8000;

/** Dedup scope for alerts that are not tied to a camera (e.g. SOS). */
const NO_CAMERA_SCOPE = '__no_camera__';

/**
 * SOS alerts have no camera; scope them under a sentinel key so their
 * optimistic local row is still suppressed once the realtime insert echoes
 * back. Writer and reader must agree, so both go through this.
 */
function scopeFor(cameraId: string | null): string {
  return cameraId ?? NO_CAMERA_SCOPE;
}

export function markLocalAlert(cameraId: string | null, type: string): void {
  recentLocalAlertKeys.set(`${scopeFor(cameraId)}:${type}`, Date.now());
}

export function wasLocalAlertRecent(cameraId: string | null, type: string): boolean {
  const t = recentLocalAlertKeys.get(`${scopeFor(cameraId)}:${type}`);
  if (!t) return false;
  return Date.now() - t < LOCAL_ALERT_DEDUP_MS;
}
