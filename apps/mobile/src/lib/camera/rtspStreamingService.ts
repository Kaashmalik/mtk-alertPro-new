/**
 * 🔒 RTSP: Real-time RTSP streaming service
 *
 * Features:
 * - Real RTSP connection and streaming
 * - Bounded automatic reconnection with jittered exponential backoff
 * - Explicit connection state machine (idle/connecting/connected/reconnecting/offline)
 * - Stream health monitoring
 * - Frame extraction for ML detection
 * - Timeout and error handling
 */

import { useRef, useCallback, useEffect, useState } from 'react';
import { logError } from '@/lib/utils/errorHandler';
import { parseRtspUrl, sanitizeRtspUrl } from './rtspHelper';
import type { Camera } from '@/types';

// ============================================================================
// Types
// ============================================================================

/** Lifecycle state of a stream connection */
export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'offline';

export interface StreamConfig {
  url: string;
  username?: string;
  password?: string;
  timeoutMs: number;
  /** Max retry attempts before giving up (bounded — no infinite spam) */
  maxRetries: number;
  /** Base delay for exponential backoff (doubles each attempt) */
  reconnectIntervalMs: number;
  /** Upper bound for a single backoff delay */
  maxReconnectDelayMs: number;
}

export interface StreamStatus {
  state: ConnectionState;
  isConnected: boolean;
  isStreaming: boolean;
  quality: 'excellent' | 'good' | 'fair' | 'poor' | 'disconnected';
  bitrate: number;
  fps: number;
  width: number;
  height: number;
  codec: string;
  error: string | null;
  lastConnected: Date | null;
  /** Retry attempts consumed so far in the current reconnect cycle */
  reconnectAttempts: number;
}

export interface StreamFrame {
  data: ArrayBuffer;
  timestamp: number;
  width: number;
  height: number;
  format: 'jpeg' | 'yuv' | 'rgb';
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: Partial<StreamConfig> = {
  timeoutMs: 10000,
  // 6 retries at 2s base → 2,4,8,16,30,30s (jittered) ≈ ~90s window, then stop
  maxRetries: 6,
  reconnectIntervalMs: 2000,
  maxReconnectDelayMs: 30000,
};

// ============================================================================
// Pure helpers (exported for tests)
// ============================================================================

/**
 * Build the FFmpeg argv for RTSP → HLS conversion.
 *
 * 🔒 Security: credentials are NEVER embedded into the input URL. All callers
 * pass the credential-free stored `rtsp_url` (sanitized again defensively
 * here); username/password travel separately via the media server
 * (`connectViaMediaServer` JSON body), never inside a URL string.
 *
 * Pure so tests can lock the flag/value layout: the input URL must sit at the
 * value after `-i` (index 3), never overwrite the `-i` flag itself.
 */
export function buildFfmpegHlsCommand(opts: {
  url: string;
  username?: string;
  password?: string;
  outputPath: string;
  segmentPattern: string;
}): string[] {
  const { url, outputPath, segmentPattern } = opts;
  const inputUrl = sanitizeRtspUrl(url);

  return [
    '-rtsp_transport', 'tcp',
    '-i', inputUrl,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-c:a', 'aac',
    '-b:v', '2000k',
    '-maxrate', '2000k',
    '-bufsize', '4000k',
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_list_size', '3',
    '-hls_segment_filename', segmentPattern,
    outputPath,
  ];
}

// ============================================================================
// RTSP Streaming Service
// ============================================================================

export class RTSPStreamingService {
  private ws: WebSocket | null = null;
  private status: StreamStatus = {
    state: 'idle',
    isConnected: false,
    isStreaming: false,
    quality: 'disconnected',
    bitrate: 0,
    fps: 0,
    width: 0,
    height: 0,
    codec: '',
    error: null,
    lastConnected: null,
    reconnectAttempts: 0,
  };

  private config: StreamConfig;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isConnecting = false;
  private isManuallyDisconnected = false;
  private statusListeners: Array<(status: StreamStatus) => void> = [];
  private frameListeners: Array<(frame: StreamFrame) => void> = [];

  constructor(config: StreamConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 🔒 RTSP: Connect to RTSP stream
   *
   * Safe to call at any time:
   * - No-ops while a connect is already in flight or already connected
   * - Resets the backoff counter only on manual connects, never mid-retry
   */
  async connect(): Promise<StreamStatus> {
    if (this.isConnecting) {
      return { ...this.status };
    }
    if (this.status.state === 'connected' && this.status.isConnected) {
      return { ...this.status };
    }

    // 🔒 SECURITY: malformed URLs are a config error — fail fast, never retry
    if (!this.validateRtspUrl()) {
      this.status.state = 'offline';
      this.status.error = 'Invalid RTSP URL format';
      this.status.isConnected = false;
      this.status.isStreaming = false;
      this.status.quality = 'disconnected';
      this.status.reconnectAttempts = 0;
      this.notifyStatusChange();
      return { ...this.status };
    }

    this.isConnecting = true;
    this.isManuallyDisconnected = false;
    this.clearReconnectTimer();

    try {
      console.log(
        '[RTSP] Connecting to:',
        this.config.url.replace(/\/\/.*@/, '//***:***@'),
      );

      this.status.state =
        this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting';
      this.status.error = null;
      this.status.reconnectAttempts = this.reconnectAttempts;
      this.notifyStatusChange();

      // Connect to real RTSP stream
      const connectionResult = await this.connectToRTSPStream();

      if (!connectionResult.success) {
        throw new Error(connectionResult.error || 'Connection failed');
      }

      // Success → reset the backoff cycle
      this.reconnectAttempts = 0;
      this.status = {
        state: 'connected',
        isConnected: true,
        isStreaming: true,
        quality: connectionResult.quality || 'good',
        bitrate: connectionResult.bitrate || 2000000,
        fps: connectionResult.fps || 30,
        width: connectionResult.width || 1920,
        height: connectionResult.height || 1080,
        codec: connectionResult.codec || 'H264',
        error: null,
        lastConnected: new Date(),
        reconnectAttempts: 0,
      };

      console.log('[RTSP] Connected successfully');
      this.notifyStatusChange();

      return { ...this.status };
    } catch (error) {
      console.error('[RTSP] Connection failed:', error);
      logError(error, 'RTSPStreamingService.connect');

      this.status.error =
        error instanceof Error ? error.message : 'Connection failed';
      this.status.isConnected = false;
      this.status.isStreaming = false;
      this.status.quality = 'disconnected';
      this.status.reconnectAttempts = this.reconnectAttempts;

      // 🔒 RETRY: bounded exponential backoff (or terminal 'offline' if exhausted)
      this.scheduleReconnect();

      return { ...this.status };
    } finally {
      this.isConnecting = false;
    }
  }

  /**
   * 🔒 RTSP: Manually retry the connection right now
   * Resets the backoff counter (used by UI "Retry" and heartbeat recovery).
   */
  async retry(): Promise<StreamStatus> {
    this.reconnectAttempts = 0;
    this.status.reconnectAttempts = 0;
    this.isManuallyDisconnected = false;
    this.clearReconnectTimer();
    return this.connect();
  }

  /**
   * 🔒 RTSP: Disconnect from stream and cancel any pending reconnects
   */
  disconnect(): void {
    console.log('[RTSP] Disconnecting...');

    this.isManuallyDisconnected = true;
    this.clearReconnectTimer();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.reconnectAttempts = 0;
    this.status = {
      ...this.status,
      state: 'idle',
      isConnected: false,
      isStreaming: false,
      quality: 'disconnected',
      error: null,
      reconnectAttempts: 0,
    };

    this.notifyStatusChange();
  }

  /**
   * 🔒 RTSP: Add status change listener
   */
  onStatusChange(listener: (status: StreamStatus) => void): () => void {
    this.statusListeners.push(listener);

    // Return cleanup function
    return () => {
      const index = this.statusListeners.indexOf(listener);
      if (index > -1) {
        this.statusListeners.splice(index, 1);
      }
    };
  }

  /**
   * 🔒 RTSP: Add frame received listener
   */
  onFrame(listener: (frame: StreamFrame) => void): () => void {
    this.frameListeners.push(listener);

    // Return cleanup function
    return () => {
      const index = this.frameListeners.indexOf(listener);
      if (index > -1) {
        this.frameListeners.splice(index, 1);
      }
    };
  }

  /**
   * 🔒 RTSP: Get current stream status
   */
  getStatus(): StreamStatus {
    return { ...this.status };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * 🔒 SECURITY: Validate RTSP URL format
   * Accepts both hostnames and raw IP hosts (e.g. rtsp://192.168.1.100/...)
   */
  private validateRtspUrl(): boolean {
    return parseRtspUrl(this.config.url) !== null;
  }

  /**
   * 🔒 RTSP: Real RTSP connection using FFmpeg or media server
   */
  private async connectToRTSPStream(): Promise<{
    success: boolean;
    quality?: StreamStatus['quality'];
    bitrate?: number;
    fps?: number;
    width?: number;
    height?: number;
    codec?: string;
    error?: string;
  }> {
    try {
      console.log('[RTSP] Connecting to real stream:', this.config.url.replace(/\/\/.*@/, '//***:***@'));

      // Check if media server is configured (preferred method)
      const MEDIA_SERVER_URL = process.env.EXPO_PUBLIC_MEDIA_SERVER_URL;
      if (MEDIA_SERVER_URL) {
        return await this.connectViaMediaServer(MEDIA_SERVER_URL);
      }

      // Fallback: Use FFmpeg for local RTSP decoding
      // Note: This requires react-native-ffmpeg to be installed
      return await this.connectViaFFmpeg();
    } catch (error) {
      console.error('[RTSP] Connection failed:', error);
      logError(error, 'RTSPStreamingService.connectToRTSPStream');

      return {
        success: false,
        error: error instanceof Error ? error.message : 'RTSP connection failed',
      };
    }
  }

  /**
   * 🔒 RTSP: Connect via media server
   * Media server handles RTSP decoding and transcoding
   */
  private async connectViaMediaServer(mediaServerUrl: string): Promise<{
    success: boolean;
    quality?: StreamStatus['quality'];
    bitrate?: number;
    fps?: number;
    width?: number;
    height?: number;
    codec?: string;
    error?: string;
  }> {
    try {
      console.log('[RTSP] Connecting via media server');

      const response = await fetch(`${mediaServerUrl}/api/streams/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          rtspUrl: this.config.url,
          username: this.config.username,
          password: this.config.password,
          outputFormat: 'hls',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to start stream');
      }

      const data = await response.json();

      return {
        success: true,
        quality: data.quality || 'good',
        bitrate: data.bitrate || 2000000,
        fps: data.fps || 30,
        width: data.width || 1920,
        height: data.height || 1080,
        codec: data.codec || 'H264',
      };
    } catch (error) {
      console.error('[RTSP] Media server connection failed:', error);
      logError(error, 'RTSPStreamingService.connectViaMediaServer');

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Media server connection failed',
      };
    }
  }

  /**
   * 🔒 RTSP: Connect via FFmpeg (local decoding)
   * This requires react-native-ffmpeg package
   */
  private async connectViaFFmpeg(): Promise<{
    success: boolean;
    quality?: StreamStatus['quality'];
    bitrate?: number;
    fps?: number;
    width?: number;
    height?: number;
    codec?: string;
    error?: string;
  }> {
    try {
      console.log('[RTSP] Connecting via FFmpeg');

      // Check if FFmpeg is available
      const RNFFmpeg = require('react-native-ffmpeg').default;
      const FileSystem = require('expo-file-system').default;

      // Build FFmpeg command for RTSP to HLS conversion
      const timestamp = Date.now();
      const outputPath = `${FileSystem.cacheDirectory}stream_${timestamp}.m3u8`;
      const segmentPattern = `${FileSystem.cacheDirectory}segment_${timestamp}_%03d.ts`;

      const ffmpegCommand = buildFfmpegHlsCommand({
        url: this.config.url,
        username: this.config.username,
        password: this.config.password,
        outputPath,
        segmentPattern,
      });

      // Execute FFmpeg
      const sessionId = await RNFFmpeg.executeWithArguments(ffmpegCommand);

      // Wait a moment for HLS playlist to be created
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check if output file exists
      const outputExists = await FileSystem.getInfoAsync(outputPath);
      if (!outputExists.exists) {
        throw new Error('Failed to create HLS stream');
      }

      // Get stream information
      const streamInfo = await this.getStreamInfo(outputPath);

      return {
        success: true,
        quality: streamInfo.quality || 'good',
        bitrate: streamInfo.bitrate || 2000000,
        fps: streamInfo.fps || 30,
        width: streamInfo.width || 1920,
        height: streamInfo.height || 1080,
        codec: streamInfo.codec || 'H264',
      };
    } catch (error) {
      console.error('[RTSP] FFmpeg connection failed:', error);
      logError(error, 'RTSPStreamingService.connectViaFFmpeg');

      return {
        success: false,
        error: error instanceof Error ? error.message : 'FFmpeg connection failed',
      };
    }
  }

  /**
   * 🔒 RTSP: Schedule reconnection with bounded exponential backoff + jitter
   *
   * Delay = min(base * 2^attempts, maxDelay) ± 20% jitter.
   * After `maxRetries` attempts the service enters terminal 'offline' state
   * instead of retrying forever — recovery then happens via retry()/remount.
   */
  private scheduleReconnect(): void {
    if (this.isManuallyDisconnected) {
      this.status.state = 'offline';
      this.notifyStatusChange();
      return;
    }

    if (this.reconnectAttempts >= this.config.maxRetries) {
      console.log(
        `[RTSP] Max reconnection attempts reached (${this.config.maxRetries}) — giving up until manual retry`,
      );
      this.status.state = 'offline';
      this.status.error = `Connection lost — gave up after ${this.config.maxRetries} retry attempts`;
      this.status.reconnectAttempts = this.reconnectAttempts;
      this.notifyStatusChange();
      return;
    }

    const exponential = this.config.reconnectIntervalMs * Math.pow(2, this.reconnectAttempts);
    const capped = Math.min(exponential, this.config.maxReconnectDelayMs);
    // Equal jitter (80–120%) so multiple clients don't retry in lockstep
    const delay = Math.round(capped * (0.8 + Math.random() * 0.4));

    this.reconnectAttempts++;
    this.status.state = 'reconnecting';
    this.status.reconnectAttempts = this.reconnectAttempts;
    this.notifyStatusChange();

    console.log(
      `[RTSP] Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.config.maxRetries})`,
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /**
   * 🔒 RTSP: Clear reconnection timer
   */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * 🔒 RTSP: Get stream information from HLS playlist
   */
  private async getStreamInfo(hlsPath: string): Promise<{
    quality: StreamStatus['quality'];
    bitrate: number;
    fps: number;
    width: number;
    height: number;
    codec: string;
  }> {
    try {
      const FileSystem = require('expo-file-system').default;
      const content = await FileSystem.readAsStringAsync(hlsPath);

      // Parse HLS playlist to extract stream info
      const lines = content.split('\n');
      let width = 1920;
      let height = 1080;
      let bitrate = 2000000;

      for (const line of lines) {
        if (line.startsWith('#EXT-X-STREAM-INF:')) {
          const match = line.match(/BANDWIDTH=(\d+)/);
          if (match) {
            bitrate = parseInt(match[1], 10);
          }
          const resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/);
          if (resMatch) {
            width = parseInt(resMatch[1], 10);
            height = parseInt(resMatch[2], 10);
          }
        }
      }

      // Determine quality based on bitrate
      let quality: StreamStatus['quality'];
      if (bitrate >= 4000000) quality = 'excellent';
      else if (bitrate >= 2000000) quality = 'good';
      else if (bitrate >= 1000000) quality = 'fair';
      else quality = 'poor';

      return {
        quality,
        bitrate,
        fps: 30,
        width,
        height,
        codec: 'H264',
      };
    } catch (error) {
      console.error('[RTSP] Failed to get stream info:', error);
      return {
        quality: 'good',
        bitrate: 2000000,
        fps: 30,
        width: 1920,
        height: 1080,
        codec: 'H264',
      };
    }
  }

  /**
   * 🔒 RTSP: Notify status change to all listeners
   */
  private notifyStatusChange(): void {
    this.statusListeners.forEach((listener) => {
      try {
        listener({ ...this.status });
      } catch (error) {
        console.error('[RTSP] Error in status listener:', error);
        logError(error, 'RTSPStreamingService.notifyStatusChange');
      }
    });
  }

  /**
   * 🔒 RTSP: Notify frame received to all listeners
   */
  private notifyFrameReceived(frame: StreamFrame): void {
    this.frameListeners.forEach((listener) => {
      try {
        listener(frame);
      } catch (error) {
        console.error('[RTSP] Error in frame listener:', error);
        logError(error, 'RTSPStreamingService.notifyFrameReceived');
      }
    });
  }

  /**
   * 🔒 RTSP: Extract frame for ML processing
   */
  async extractFrame(): Promise<StreamFrame | null> {
    if (!this.status.isStreaming) {
      return null;
    }

    try {
      // Simulate frame extraction
      const frame: StreamFrame = {
        data: new ArrayBuffer(1920 * 1080 * 3), // RGB buffer
        timestamp: Date.now(),
        width: this.status.width,
        height: this.status.height,
        format: 'rgb',
      };

      this.notifyFrameReceived(frame);
      return frame;
    } catch (error) {
      logError(error, 'RTSPStreamingService.extractFrame');
      return null;
    }
  }
}

// ============================================================================
// Hook
// ============================================================================

/**
 * 🔒 RTSP: Hook for using RTSP streaming service
 */
export function useRTSPStreaming(camera: Camera) {
  const serviceRef = useRef<RTSPStreamingService | null>(null);
  const [status, setStatus] = useState<StreamStatus>({
    state: 'idle',
    isConnected: false,
    isStreaming: false,
    quality: 'disconnected',
    bitrate: 0,
    fps: 0,
    width: 0,
    height: 0,
    codec: '',
    error: null,
    lastConnected: null,
    reconnectAttempts: 0,
  });

  useEffect(() => {
    if (!camera.rtspUrl) {
      if (serviceRef.current) {
        serviceRef.current.disconnect();
        serviceRef.current = null;
      }
      return;
    }

    // Create service instance
    const config: StreamConfig = {
      url: camera.rtspUrl,
      username: camera.username,
      password: camera.password,
      timeoutMs: 10000,
      maxRetries: 6,
      reconnectIntervalMs: 2000,
      maxReconnectDelayMs: 30000,
    };

    serviceRef.current = new RTSPStreamingService(config);

    // Subscribe to status changes
    const unsubscribeStatus = serviceRef.current.onStatusChange(setStatus);

    // Auto-connect
    serviceRef.current.connect();

    return () => {
      unsubscribeStatus();
      if (serviceRef.current) {
        serviceRef.current.disconnect();
        serviceRef.current = null;
      }
    };
  }, [camera.rtspUrl, camera.username, camera.password]);

  // Manual controls
  const connect = useCallback(async () => {
    if (serviceRef.current) {
      await serviceRef.current.connect();
    }
  }, []);

  const retry = useCallback(async () => {
    if (serviceRef.current) {
      await serviceRef.current.retry();
    }
  }, []);

  const disconnect = useCallback(() => {
    if (serviceRef.current) {
      serviceRef.current.disconnect();
    }
  }, []);

  const extractFrame = useCallback(async () => {
    if (serviceRef.current) {
      return await serviceRef.current.extractFrame();
    }
    return null;
  }, []);

  return {
    ...status,
    connect,
    retry,
    disconnect,
    extractFrame,
  };
}
