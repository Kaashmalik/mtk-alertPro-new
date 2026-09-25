/**
 * Media server health helpers for app startup and UI banners
 */

import { streamingService } from './streamingService';

export type MediaEdgeStatus = 'unknown' | 'online' | 'offline';

let cachedStatus: MediaEdgeStatus = 'unknown';
let listeners = new Set<(status: MediaEdgeStatus) => void>();

export function getCachedMediaEdgeStatus(): MediaEdgeStatus {
  return cachedStatus;
}

export function subscribeMediaEdgeStatus(
  listener: (status: MediaEdgeStatus) => void
): () => void {
  listeners.add(listener);
  listener(cachedStatus);
  return () => {
    listeners.delete(listener);
  };
}

function setStatus(status: MediaEdgeStatus) {
  cachedStatus = status;
  listeners.forEach((l) => l(status));
}

/**
 * Probe media edge and update subscribers. Safe to call at app start.
 */
export async function refreshMediaEdgeHealth(): Promise<MediaEdgeStatus> {
  const ok = await streamingService.checkMediaServerHealth(true);
  setStatus(ok ? 'online' : 'offline');
  return cachedStatus;
}

export function getMediaServerEnvHint(): string {
  const url = process.env.EXPO_PUBLIC_MEDIA_SERVER_URL;
  if (!url) {
    return 'EXPO_PUBLIC_MEDIA_SERVER_URL is not set. Add it to apps/mobile/.env';
  }
  return `Media server: ${url}`;
}
