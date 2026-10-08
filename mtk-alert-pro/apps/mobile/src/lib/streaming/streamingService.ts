/**
 * Streaming Service
 * Manages camera stream registration and playback with the media server
 * 
 * @module lib/streaming/streamingService
 */

import { logError, withRetry } from '@/lib/utils/errorHandler';

// Configuration from environment
const MEDIA_SERVER_URL = process.env.EXPO_PUBLIC_MEDIA_SERVER_URL || 'http://localhost:3001';
const HLS_SERVER_URL = process.env.EXPO_PUBLIC_HLS_SERVER_URL || 'http://localhost:8888';

/**
 * Stream URLs for different playback methods
 */
export interface StreamUrls {
  /** HLS stream URL (most compatible) */
  hls: string;
  /** WebRTC URL (lowest latency) */
  webrtc: string;
  /** Direct RTSP URL (via media server) */
  rtsp: string;
}

/**
 * Stream status information
 */
export interface StreamStatus {
  /** Whether the stream is online and ready */
  online: boolean;
  /** Number of current viewers */
  readers: number;
  /** Connection latency in ms */
  latency?: number;
  /** Available tracks (video/audio) */
  tracks?: Array<{ type: string; codec: string }>;
}

/**
 * Stream registration result
 */
export interface StreamRegistration {
  /** Whether registration was successful */
  success: boolean;
  /** Path name on media server */
  pathName?: string;
  /** Stream URLs */
  streams?: StreamUrls;
  /** Error message if failed */
  error?: string;
}

/**
 * Connection test result
 */
export interface ConnectionTest {
  /** Whether connection was successful */
  connected: boolean;
  /** Stream information if connected */
  streamInfo?: {
    ready: boolean;
    tracks?: Array<{ type: string }>;
  };
  /** Error message if failed */
  error?: string;
}

/**
 * Streaming Service class
 * Manages camera streams with the media server
 */
class StreamingService {
  /** Set of currently registered camera IDs */
  private registeredCameras: Set<string> = new Set();
  
  /** Cache of stream URLs */
  private streamUrlCache: Map<string, StreamUrls> = new Map();
  
  /** Stream status cache with timestamps */
  private statusCache: Map<string, { status: StreamStatus; timestamp: number }> = new Map();
  
  /** Status cache TTL in ms */
  private readonly STATUS_CACHE_TTL = 5000; // 5 seconds

  /** Last known media server health */
  private mediaServerHealthy: boolean | null = null;
  private lastHealthCheck = 0;
  private readonly HEALTH_CACHE_TTL = 10000;

  /** Default per-request timeout so the UI never hangs on a dead media server */
  private readonly REQUEST_TIMEOUT_MS = 8000;

  /**
   * fetch() with an abort-based timeout. A camera/media-server that stops
   * responding mid-request would otherwise leave the promise pending forever,
   * freezing spinners in the UI. Every network call in this service goes
   * through here so playback failures surface fast and can be retried.
   */
  private async fetchWithTimeout(
    input: string,
    init: RequestInit = {},
    timeoutMs: number = this.REQUEST_TIMEOUT_MS
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Check if the media edge (API + MediaMTX) is reachable
   */
  async checkMediaServerHealth(force = false): Promise<boolean> {
    if (
      !force &&
      this.mediaServerHealthy !== null &&
      Date.now() - this.lastHealthCheck < this.HEALTH_CACHE_TTL
    ) {
      return this.mediaServerHealthy;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const response = await fetch(`${MEDIA_SERVER_URL}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      this.mediaServerHealthy = response.ok;
      this.lastHealthCheck = Date.now();
      return this.mediaServerHealthy;
    } catch {
      this.mediaServerHealthy = false;
      this.lastHealthCheck = Date.now();
      return false;
    }
  }

  /**
   * Cache stream URLs after registration (HLS + WebRTC)
   */
  cachePreferredStreams(cameraId: string, streams: StreamUrls): void {
    this.streamUrlCache.set(cameraId, streams);
  }

  /**
   * Resolve best playable URL: HLS for expo-av; WebRTC available for native clients
   */
  getPreferredPlayUrl(
    cameraId: string,
    prefer: 'hls' | 'webrtc' = 'hls'
  ): string | null {
    const cached = this.streamUrlCache.get(cameraId);
    if (!cached) return null;
    if (prefer === 'webrtc' && cached.webrtc) return cached.webrtc;
    return cached.hls || null;
  }

  getMediaServerUrl(): string {
    return MEDIA_SERVER_URL;
  }

  /**
   * Test if an RTSP URL is valid and camera is reachable
   * This goes through the media server for proper RTSP testing
   * 
   * @param rtspUrl - The RTSP URL to test
   * @returns Connection test result
   */
  async testConnection(rtspUrl: string): Promise<ConnectionTest> {
    try {
      const response = await withRetry(
        () => this.fetchWithTimeout(`${MEDIA_SERVER_URL}/api/cameras/test-connection`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rtspUrl }),
        }),
        { maxRetries: 2, delayMs: 1000 }
      );

      if (!response.ok) {
        return {
          connected: false,
          error: `Server error: ${response.status}`,
        };
      }

      const data = await response.json();
      return {
        connected: data.connected === true,
        streamInfo: data.streamInfo,
        error: data.error,
      };
    } catch (error) {
      logError(error, 'StreamingService.testConnection');
      return {
        connected: false,
        error: error instanceof Error ? error.message : 'Connection test failed',
      };
    }
  }

  /**
   * Register a camera with the media server
   * This sets up the RTSP → HLS conversion
   * 
   * @param cameraId - Unique camera identifier
   * @param rtspUrl - Camera's RTSP URL
   * @param userId - User who owns the camera
   * @returns Registration result with stream URLs
   */
  async registerCamera(
    cameraId: string,
    rtspUrl: string,
    userId: string
  ): Promise<StreamRegistration> {
    try {
      // Registration kicks off the RTSP→HLS pipeline and is the single most
      // important call for playback to work, so it gets a bounded retry.
      const response = await withRetry(
        () =>
          this.fetchWithTimeout(`${MEDIA_SERVER_URL}/api/cameras/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cameraId, rtspUrl, userId }),
          }),
        { maxRetries: 2, delayMs: 1000 }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          success: false,
          error: errorData.error || `Registration failed: ${response.status}`,
        };
      }

      const data = await response.json();
      
      if (data.success && data.streams) {
        this.registeredCameras.add(cameraId);
        this.streamUrlCache.set(cameraId, data.streams);
        
        return {
          success: true,
          pathName: data.pathName,
          streams: data.streams,
        };
      }

      return {
        success: false,
        error: data.error || 'Registration failed',
      };
    } catch (error) {
      logError(error, 'StreamingService.registerCamera');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to register camera',
      };
    }
  }

  /**
   * Unregister a camera from the media server
   * Call this when done viewing a stream
   * 
   * @param cameraId - Camera to unregister
   * @returns Whether unregistration was successful
   */
  async unregisterCamera(cameraId: string): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(
        `${MEDIA_SERVER_URL}/api/cameras/${cameraId}/unregister`,
        { method: 'DELETE' }
      );

      this.registeredCameras.delete(cameraId);
      this.streamUrlCache.delete(cameraId);
      this.statusCache.delete(cameraId);

      return response.ok;
    } catch (error) {
      logError(error, 'StreamingService.unregisterCamera');
      // Still remove from local cache
      this.registeredCameras.delete(cameraId);
      this.streamUrlCache.delete(cameraId);
      return false;
    }
  }

  /**
   * Get current stream status
   * 
   * @param cameraId - Camera to check
   * @param useCache - Whether to use cached status (default: true)
   * @returns Stream status
   */
  async getStreamStatus(cameraId: string, useCache: boolean = true): Promise<StreamStatus> {
    // Check cache first
    if (useCache) {
      const cached = this.statusCache.get(cameraId);
      if (cached && Date.now() - cached.timestamp < this.STATUS_CACHE_TTL) {
        return cached.status;
      }
    }

    try {
      const response = await this.fetchWithTimeout(
        `${MEDIA_SERVER_URL}/api/cameras/${cameraId}/status`
      );

      if (!response.ok) {
        return { online: false, readers: 0 };
      }

      const status = await response.json();
      
      // Update cache
      this.statusCache.set(cameraId, {
        status,
        timestamp: Date.now(),
      });

      return status;
    } catch (error) {
      return { online: false, readers: 0 };
    }
  }

  /**
   * Get HLS stream URL for a camera
   * 
   * @param cameraId - Camera ID
   * @returns HLS stream URL
   */
  getHlsUrl(cameraId: string): string {
    // Check cache first
    const cached = this.streamUrlCache.get(cameraId);
    if (cached) {
      return cached.hls;
    }
    
    // Generate URL based on naming convention
    const pathName = `cam_${cameraId.replace(/-/g, '')}`;
    return `${HLS_SERVER_URL}/${pathName}/index.m3u8`;
  }

  /**
   * Get WebRTC stream URL for a camera (lower latency)
   * 
   * @param cameraId - Camera ID
   * @returns WebRTC stream URL
   */
  getWebRtcUrl(cameraId: string): string {
    const cached = this.streamUrlCache.get(cameraId);
    if (cached) {
      return cached.webrtc;
    }
    
    const pathName = `cam_${cameraId.replace(/-/g, '')}`;
    const webrtcPort = 8889;
    const baseUrl = MEDIA_SERVER_URL.replace(':3001', '');
    return `${baseUrl}:${webrtcPort}/${pathName}`;
  }

  /**
   * Check if a camera is currently registered
   * 
   * @param cameraId - Camera ID to check
   * @returns Whether the camera is registered
   */
  isRegistered(cameraId: string): boolean {
    return this.registeredCameras.has(cameraId);
  }

  /**
   * Capture a snapshot from the stream
   * 
   * @param cameraId - Camera to capture from
   * @returns Snapshot URL or null if failed
   */
  async captureSnapshot(cameraId: string): Promise<string | null> {
    try {
      const response = await this.fetchWithTimeout(
        `${MEDIA_SERVER_URL}/api/cameras/${cameraId}/snapshot`,
        { method: 'POST' }
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      // Normalize relative snapshot paths to absolute media-server URLs
      let snapshotUrl: string | null = data.snapshotUrl || null;
      if (snapshotUrl && snapshotUrl.startsWith('/')) {
        snapshotUrl = `${MEDIA_SERVER_URL}${snapshotUrl}`;
      }
      return snapshotUrl;
    } catch (error) {
      logError(error, 'StreamingService.captureSnapshot');
      return null;
    }
  }

  /**
   * Start recording a camera stream
   * 
   * @param cameraId - Camera to record
   * @param durationSeconds - Recording duration (default: 30s, max: 300s)
   * @returns Whether recording started successfully
   */
  async startRecording(
    cameraId: string,
    durationSeconds: number = 30
  ): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(
        `${MEDIA_SERVER_URL}/api/cameras/${cameraId}/record/start`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ durationSeconds }),
        }
      );

      return response.ok;
    } catch (error) {
      logError(error, 'StreamingService.startRecording');
      return false;
    }
  }

  /**
   * Stop recording a camera stream
   * 
   * @param cameraId - Camera to stop recording
   * @returns Whether recording stopped successfully
   */
  async stopRecording(cameraId: string): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(
        `${MEDIA_SERVER_URL}/api/cameras/${cameraId}/record/stop`,
        { method: 'POST' }
      );

      return response.ok;
    } catch (error) {
      logError(error, 'StreamingService.stopRecording');
      return false;
    }
  }

  /**
   * Unregister all cameras (cleanup)
   */
  async unregisterAll(): Promise<void> {
    const cameras = Array.from(this.registeredCameras);
    
    await Promise.all(
      cameras.map(cameraId => this.unregisterCamera(cameraId))
    );
  }

  /**
   * Clear all caches
   */
  clearCaches(): void {
    this.streamUrlCache.clear();
    this.statusCache.clear();
  }
}

// Export singleton instance
export const streamingService = new StreamingService();

// Export class for testing
export { StreamingService };

