/**
 * Local alert dedup — prevents realtime subscriber from double-ringing
 * when detectionManager already handled the same event.
 */

const recentLocalAlertKeys = new Map<string, number>();
const LOCAL_ALERT_DEDUP_MS = 8000;

export function markLocalAlert(cameraId: string, type: string): void {
  recentLocalAlertKeys.set(`${cameraId}:${type}`, Date.now());
}

export function wasLocalAlertRecent(cameraId: string, type: string): boolean {
  const t = recentLocalAlertKeys.get(`${cameraId}:${type}`);
  if (!t) return false;
  return Date.now() - t < LOCAL_ALERT_DEDUP_MS;
}
