/**
 * Unified stream session: register → prefer HLS (WebRTC cached) → reconnect backoff → unregister
 */

import { streamingService, type StreamUrls, type StreamStatus } from './streamingService';
import { isDirectHttpStream } from '@/lib/camera/protocol';

export type StreamSessionState =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'offline'
  | 'server_unavailable'
  | 'error';

export interface StreamSessionOptions {
  cameraId: string;
  rtspUrl: string;
  userId: string;
  maxRetries?: number;
  baseDelayMs?: number;
  onStateChange?: (state: StreamSessionState) => void;
  onUrls?: (urls: StreamUrls) => void;
  onStatus?: (status: StreamStatus) => void;
  onError?: (message: string) => void;
}

export class StreamSession {
  private opts: StreamSessionOptions;
  private state: StreamSessionState = 'idle';
  private retryCount = 0;
  private destroyed = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private urls: StreamUrls | null = null;

  constructor(opts: StreamSessionOptions) {
    this.opts = {
      maxRetries: 5,
      baseDelayMs: 2000,
      ...opts,
    };
  }

  getState(): StreamSessionState {
    return this.state;
  }

  getUrls(): StreamUrls | null {
    return this.urls;
  }

  /** Best URL for expo-av (HLS). WebRTC reserved for native players. */
  getPlayUrl(): string | null {
    if (isDirectHttpStream(this.opts.rtspUrl)) {
      return this.opts.rtspUrl;
    }
    return this.urls?.hls ?? null;
  }

  private setState(state: StreamSessionState) {
    this.state = state;
    this.opts.onStateChange?.(state);
  }

  async start(): Promise<string | null> {
    if (this.destroyed) return null;

    if (isDirectHttpStream(this.opts.rtspUrl)) {
      this.setState('live');
      return this.opts.rtspUrl;
    }

    this.setState(this.retryCount > 0 ? 'reconnecting' : 'connecting');

    const healthy = await streamingService.checkMediaServerHealth();
    if (!healthy) {
      this.setState('server_unavailable');
      this.opts.onError?.(
        'Media server unavailable. Start MediaMTX + API or set EXPO_PUBLIC_MEDIA_SERVER_URL.'
      );
      this.scheduleRetry();
      return null;
    }

    const registration = await streamingService.registerCamera(
      this.opts.cameraId,
      this.opts.rtspUrl,
      this.opts.userId
    );

    if (!registration.success || !registration.streams) {
      const msg = registration.error || 'Failed to register camera';
      this.setState('error');
      this.opts.onError?.(msg);
      this.scheduleRetry();
      return null;
    }

    this.urls = registration.streams;
    streamingService.cachePreferredStreams(this.opts.cameraId, registration.streams);
    this.opts.onUrls?.(registration.streams);

    try {
      const status = await streamingService.getStreamStatus(this.opts.cameraId, false);
      this.opts.onStatus?.(status);
    } catch {
      // ignore
    }

    this.retryCount = 0;
    this.setState('live');
    return registration.streams.hls;
  }

  private scheduleRetry() {
    const max = this.opts.maxRetries ?? 5;
    if (this.destroyed || this.retryCount >= max) {
      this.setState('offline');
      return;
    }

    const delay = (this.opts.baseDelayMs ?? 2000) * Math.pow(2, this.retryCount);
    this.retryCount += 1;
    this.setState('reconnecting');

    this.retryTimer = setTimeout(() => {
      void this.start();
    }, Math.min(delay, 30000));
  }

  async retryNow(): Promise<string | null> {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    return this.start();
  }

  async stop(): Promise<void> {
    this.destroyed = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (!isDirectHttpStream(this.opts.rtspUrl)) {
      await streamingService.unregisterCamera(this.opts.cameraId).catch(() => {});
    }
    this.setState('idle');
  }
}
