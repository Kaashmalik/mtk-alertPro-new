/**
 * Camera Connection Service
 * Provides camera connectivity testing and health monitoring
 *
 * @module lib/camera/connectionService
 */

import { detectStreamProtocol, parseHttpStreamUrl } from './protocol';
import { parseRtspUrl } from './rtspHelper';

/**
 * Result of a camera connection test
 */
export interface ConnectionTestResult {
  /** Whether the connection was successful */
  success: boolean;
  /** Latency in milliseconds (if successful) */
  latency?: number;
  /** Error message (if failed) */
  error?: string;
  /** Stream information (if available) */
  streamInfo?: {
    width?: number;
    height?: number;
    codec?: string;
    fps?: number;
  };
  /** Timestamp of the test */
  timestamp: Date;
}

/**
 * Camera health status
 */
export interface CameraHealth {
  /** Camera ID */
  cameraId: string;
  /** Live connection status for UI display */
  status: CameraConnectionStatus;
  /** Whether the camera is online (derived from status) */
  isOnline: boolean;
  /** Average latency over recent tests */
  avgLatency: number;
  /** Last successful connection time */
  lastOnline?: Date;
  /** Last heartbeat check time */
  lastChecked?: Date;
  /** Number of consecutive failures */
  failureCount: number;
  /** Last test result */
  lastTest: ConnectionTestResult;
}

/**
 * Live connection status of a camera
 * - unknown: no heartbeat result yet (cold start)
 * - online: last heartbeat succeeded
 * - reconnecting: transient failures, heartbeat still retrying
 * - offline: sustained failures past the offline threshold
 */
export type CameraConnectionStatus =
  | 'online'
  | 'offline'
  | 'reconnecting'
  | 'unknown';

/**
 * Configuration for connection testing
 */
export interface ConnectionTestConfig {
  /** Timeout in milliseconds */
  timeoutMs: number;
  /** Number of retry attempts */
  retryCount: number;
  /** Delay between retries in milliseconds */
  retryDelayMs: number;
}

const DEFAULT_CONFIG: ConnectionTestConfig = {
  timeoutMs: 5000,
  retryCount: 2,
  retryDelayMs: 1000,
};

/**
 * Test camera connectivity by attempting to reach the camera's HTTP interface
 *
 * @param rtspUrl - The RTSP URL of the camera
 * @param config - Test configuration
 * @returns ConnectionTestResult
 *
 * @example
 * ```ts
 * const result = await testCameraConnection('rtsp://192.168.1.100:554/stream');
 * if (result.success) {
 *   console.log(`Camera online with ${result.latency}ms latency`);
 * }
 * ```
 */
export async function testCameraConnection(
  streamUrl: string,
  config: Partial<ConnectionTestConfig> = {},
): Promise<ConnectionTestResult> {
  const { timeoutMs, retryCount, retryDelayMs } = {
    ...DEFAULT_CONFIG,
    ...config,
  };
  const startTime = Date.now();
  const protocol = detectStreamProtocol(streamUrl);

  // --- HTTP / MJPEG / snapshot URL: probe the URL itself ---
  if (protocol === 'http' || protocol === 'mjpeg' || protocol === 'hls') {
    const parsedHttp = parseHttpStreamUrl(streamUrl);
    if (!parsedHttp) {
      return {
        success: false,
        error:
          'Invalid HTTP stream URL. Expected: http(s)://[user:pass@]host[:port]/path',
        timestamp: new Date(),
      };
    }

    let lastError: string | undefined;
    for (let attempt = 0; attempt <= retryCount; attempt++) {
      if (attempt > 0) {
        await delay(retryDelayMs * attempt);
      }
      try {
        const result = await performHttpStreamTest(streamUrl, timeoutMs);
        if (result.success) {
          return {
            ...result,
            latency: Date.now() - startTime,
            timestamp: new Date(),
          };
        }
        lastError = result.error;
      } catch (error) {
        lastError =
          error instanceof Error ? error.message : 'Connection test failed';
      }
    }

    return {
      success: false,
      error: lastError || 'Connection test failed after all retries',
      latency: Date.now() - startTime,
      timestamp: new Date(),
    };
  }

  // --- RTSP URL: prefer real DESCRIBE via media server ---
  if (protocol !== 'rtsp') {
    return {
      success: false,
      error:
        'Invalid stream URL. Expected rtsp://[user:pass@]ip[:port]/path or http(s):// URL',
      timestamp: new Date(),
    };
  }

  const parsed = parseRtspUrl(streamUrl);
  if (!parsed) {
    return {
      success: false,
      error:
        'Invalid RTSP URL format. Expected: rtsp://[user:pass@]ip[:port]/path',
      timestamp: new Date(),
    };
  }

  if (!isValidIp(parsed.ip)) {
    return {
      success: false,
      error: `Invalid IP address: ${parsed.ip}`,
      timestamp: new Date(),
    };
  }

  const MEDIA_SERVER_URL = process.env.EXPO_PUBLIC_MEDIA_SERVER_URL;
  if (MEDIA_SERVER_URL) {
    try {
      const mediaResult = await testConnectionViaMediaServer(
        MEDIA_SERVER_URL,
        streamUrl,
        timeoutMs,
      );
      if (mediaResult.success) {
        return mediaResult;
      }
      // Fall through to HTTP probe if media server says unreachable
      // (camera may still be up on LAN for MJPEG)
    } catch {
      // Media server unreachable — fall back to HTTP probe
    }
  }

  let lastError: string | undefined;

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    if (attempt > 0) {
      await delay(retryDelayMs * attempt);
    }

    try {
      const result = await performConnectionTest(
        parsed.ip,
        parsed.port,
        timeoutMs,
      );

      if (result.success) {
        return {
          ...result,
          latency: Date.now() - startTime,
          timestamp: new Date(),
        };
      }

      lastError = result.error;
    } catch (error) {
      lastError =
        error instanceof Error ? error.message : 'Connection test failed';
    }
  }

  return {
    success: false,
    error: lastError || 'Connection test failed after all retries',
    latency: Date.now() - startTime,
    timestamp: new Date(),
  };
}

/**
 * Probe an HTTP/MJPEG/snapshot URL directly.
 * Resolves once response headers arrive, then cancels the body
 * (MJPEG responses are an endless multipart stream).
 */
async function performHttpStreamTest(
  url: string,
  timeoutMs: number,
): Promise<Omit<ConnectionTestResult, 'timestamp'>> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    });

    clearTimeout(timeoutId);
    // Cancel body download (MJPEG streams never end)
    try {
      controller.abort();
    } catch {
      // ignore - body cancel is best-effort
    }

    // Reachable status codes: OK, auth required, method not allowed on HEAD-like endpoints
    if (
      response.ok ||
      response.status === 401 ||
      response.status === 403 ||
      response.status === 405 ||
      response.status === 501
    ) {
      return { success: true };
    }

    return {
      success: false,
      error: `Camera responded with status ${response.status}`,
    };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        // Abort after headers is normal for MJPEG — treated as success above.
        // Reaching here means headers never arrived.
        return {
          success: false,
          error: 'Connection timed out - camera not responding',
        };
      }

      const message = error.message.toLowerCase();
      if (message.includes('network') || message.includes('failed to fetch')) {
        return {
          success: false,
          error: 'Network error - check if camera is on the same network',
        };
      }
      if (message.includes('refused')) {
        return {
          success: false,
          error: 'Connection refused - camera may be using different port',
        };
      }
    }

    return {
      success: false,
      error: 'Unable to reach camera - verify URL and network',
    };
  }
}

/**
 * Perform a single connection test
 */
async function performConnectionTest(
  ip: string,
  rtspPort: number,
  timeoutMs: number,
): Promise<Omit<ConnectionTestResult, 'timestamp'>> {
  // Most IP cameras have a web interface on port 80
  // Try to reach it as a basic connectivity check
  const httpPort = rtspPort === 554 ? 80 : rtspPort;
  const httpUrl = `http://${ip}:${httpPort}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(httpUrl, {
      method: 'HEAD',
      signal: controller.signal,
      cache: 'no-store',
    });

    clearTimeout(timeoutId);

    // 401/403 means camera is reachable but requires auth
    // 405/501 means camera rejected HEAD but is reachable (common on IP cams)
    // These are still successful connection tests
    if (
      response.ok ||
      response.status === 401 ||
      response.status === 403 ||
      response.status === 405 ||
      response.status === 501
    ) {
      // Additional check: Try to get stream info from media server if available
      try {
        const MEDIA_SERVER_URL = process.env.EXPO_PUBLIC_MEDIA_SERVER_URL;
        if (MEDIA_SERVER_URL) {
          const streamCheck = await fetch(
            `${MEDIA_SERVER_URL}/api/cameras/test-rtsp`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ip, port: rtspPort }),
              signal: AbortSignal.timeout(Math.min(timeoutMs / 2, 3000)),
            },
          );
          if (streamCheck.ok) {
            const streamData = await streamCheck.json();
            return {
              success: true,
              streamInfo: streamData.streamInfo || undefined,
            };
          }
        }
      } catch (_streamError) {
        // Media server check failed, but HTTP check passed - still consider it online
        console.warn(
          '[ConnectionTest] Media server check failed, using HTTP result',
        );
      }

      return { success: true };
    }

    return {
      success: false,
      error: `Camera responded with status ${response.status}`,
    };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return {
          success: false,
          error: 'Connection timed out - camera not responding',
        };
      }

      // Check for common network errors
      const message = error.message.toLowerCase();

      if (message.includes('network') || message.includes('failed to fetch')) {
        return {
          success: false,
          error: 'Network error - check if camera is on the same network',
        };
      }

      if (message.includes('refused')) {
        return {
          success: false,
          error: 'Connection refused - camera may be using different port',
        };
      }
    }

    return {
      success: false,
      error: 'Unable to reach camera - verify IP address and network',
    };
  }
}

/**
 * Test connection via media server
 * This provides more accurate RTSP testing when a media server is available
 *
 * @param mediaServerUrl - URL of the media server API
 * @param rtspUrl - The RTSP URL to test
 * @param timeoutMs - Timeout in milliseconds
 */
export async function testConnectionViaMediaServer(
  mediaServerUrl: string,
  rtspUrl: string,
  timeoutMs = 10000,
): Promise<ConnectionTestResult> {
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(
        `${mediaServerUrl}/api/cameras/test-connection`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rtspUrl }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        return {
          success: false,
          error: `Server error: ${response.status}`,
          latency: Date.now() - startTime,
          timestamp: new Date(),
        };
      }

      const data = await response.json();

      return {
        success: data.connected === true,
        error: data.connected ? undefined : 'Camera stream not available',
        latency: Date.now() - startTime,
        streamInfo: data.streamInfo,
        timestamp: new Date(),
      };
    } finally {
      // Clear on the throw path too. A rejected fetch (offline device, server
      // down) previously left the abort timer armed for the full timeout,
      // keeping the event loop -- and the jest worker -- alive.
      clearTimeout(timeoutId);
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'Media server test failed',
      latency: Date.now() - startTime,
      timestamp: new Date(),
    };
  }
}

/** Consecutive failures before a camera is reported as offline */
const OFFLINE_FAILURE_THRESHOLD = 3;

/** Heartbeat probe settings: fast, no retries — the monitor cadence is the retry */
const HEARTBEAT_TEST_CONFIG: Partial<ConnectionTestConfig> = {
  timeoutMs: 3000,
  retryCount: 0,
};

/**
 * Create a per-camera heartbeat monitor
 *
 * Every `intervalMs` all cameras are probed in parallel. Status transitions:
 *   unknown ──success──▶ online
 *   unknown/online ──failure──▶ reconnecting (failures 1..N-1)
 *   reconnecting ──failure──▶ offline (N consecutive failures, N = threshold)
 *   offline/reconnecting ──success──▶ online
 *
 * `onStatusChange` fires only when a camera's status actually changes
 * (including the first result after 'unknown').
 *
 * @param cameras - Array of cameras to monitor
 * @param onStatusChange - Callback when a camera's status changes
 * @param intervalMs - Check interval in milliseconds
 * @returns Cleanup function
 */
export function createHealthMonitor(
  cameras: Array<{ id: string; rtspUrl: string }>,
  onStatusChange: (cameraId: string, health: CameraHealth) => void,
  intervalMs = 30000,
): () => void {
  const healthMap = new Map<string, CameraHealth>();
  let isRunning = true;
  let inFlight = false;

  // Initialize health records — status stays 'unknown' until the first probe
  cameras.forEach((camera) => {
    healthMap.set(camera.id, {
      cameraId: camera.id,
      status: 'unknown',
      isOnline: false,
      avgLatency: 0,
      failureCount: 0,
      lastTest: {
        success: false,
        timestamp: new Date(),
      },
    });
  });

  const checkCamera = async (camera: {
    id: string;
    rtspUrl: string;
  }): Promise<void> => {
    try {
      const result = await testCameraConnection(
        camera.rtspUrl,
        HEARTBEAT_TEST_CONFIG,
      );

      if (!isRunning) return;
      const current = healthMap.get(camera.id);
      if (!current) return;

      const previousStatus = current.status;
      let status: CameraConnectionStatus;
      if (result.success) {
        status = 'online';
      } else {
        const failures = current.failureCount + 1;
        status =
          failures >= OFFLINE_FAILURE_THRESHOLD ? 'offline' : 'reconnecting';
      }

      const newHealth: CameraHealth = {
        cameraId: camera.id,
        status,
        isOnline: status === 'online',
        avgLatency: result.latency
          ? current.avgLatency
            ? (current.avgLatency + result.latency) / 2
            : result.latency
          : current.avgLatency,
        lastOnline: result.success ? new Date() : current.lastOnline,
        lastChecked: new Date(),
        failureCount: result.success ? 0 : current.failureCount + 1,
        lastTest: result,
      };

      healthMap.set(camera.id, newHealth);

      // Notify on every status transition (including first result after 'unknown')
      if (previousStatus !== status) {
        onStatusChange(camera.id, newHealth);
      }
    } catch (error) {
      // A heartbeat must never crash the monitoring interval
      console.warn('[HealthMonitor] Probe error for camera', camera.id, error);
    }
  };

  const checkAll = async () => {
    if (!isRunning || inFlight) return; // skip overlapping cycles
    inFlight = true;
    try {
      await Promise.all(cameras.map(checkCamera));
    } finally {
      inFlight = false;
    }
  };

  // Initial check — resolves 'unknown' to a real status right away
  checkAll();

  // Periodic heartbeat checks
  const intervalId = setInterval(checkAll, intervalMs);

  // Return cleanup function
  return () => {
    isRunning = false;
    clearInterval(intervalId);
  };
}

/**
 * Validate IP address format
 */
function isValidIp(ip: string): boolean {
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipRegex.test(ip)) {
    // Could also be a hostname
    return /^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]$/.test(ip);
  }

  const parts = ip.split('.').map(Number);
  return parts.every((part) => part >= 0 && part <= 255);
}

/**
 * Simple delay helper
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get connection quality based on latency
 */
export function getConnectionQuality(
  latency: number,
): 'excellent' | 'good' | 'fair' | 'poor' {
  if (latency < 100) return 'excellent';
  if (latency < 300) return 'good';
  if (latency < 1000) return 'fair';
  return 'poor';
}

/**
 * Format latency for display
 */
export function formatLatency(latency: number): string {
  if (latency < 1000) {
    return `${latency}ms`;
  }
  return `${(latency / 1000).toFixed(1)}s`;
}
