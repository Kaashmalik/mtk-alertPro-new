/**
 * Camera connection diagnostics.
 *
 * `testCameraConnection` returns low-level failures ("Server error: 404",
 * "Connection test failed after all retries", "Invalid IP address: …"). Those
 * are accurate but useless to a user staring at a phone: they do not say
 * *which* thing is misconfigured or what to change.
 *
 * This module classifies a result into a small set of actionable causes so the
 * UI can render a specific, correct next step — the difference between "it
 * doesn't work" and "your media server is not running / the phone is on a
 * different network than the camera".
 */

import type { ConnectionTestResult } from '@/lib/camera/connectionService';

export type ConnectionIssue =
  | 'camera_unreachable'
  | 'auth_failed'
  | 'invalid_url'
  | 'media_server_down'
  | 'wrong_network'
  | 'unknown';

export interface ConnectionDiagnosis {
  issue: ConnectionIssue;
  /** Short, non-technical headline. */
  title: string;
  /** One concrete action the user can take. */
  fix: string;
  /** Optional longer explanation shown behind a "details" affordance. */
  detail?: string;
  /** True when retrying without changing anything is worth trying. */
  retryable: boolean;
}

/** True when a media server URL is configured at all. */
export function isMediaServerConfigured(): boolean {
  const url = process.env.EXPO_PUBLIC_MEDIA_SERVER_URL?.trim();
  return Boolean(url && url.length > 0);
}

function mentionsAny(text: string, ...needles: string[]): boolean {
  const lower = text.toLowerCase();
  return needles.some((n) => lower.includes(n));
}

export function diagnoseConnection(
  result: ConnectionTestResult,
  context?: { rtspUrl?: string; mediaServerConfigured?: boolean },
): ConnectionDiagnosis {
  const error = result.error ?? '';
  const mediaOk = context?.mediaServerConfigured ?? isMediaServerConfigured();

  if (!result.success) {
    // A malformed URL is always a user-input problem — fixable, not retryable.
    if (
      mentionsAny(
        error,
        'invalid http',
        'invalid rtsp url',
        'invalid stream url',
        'expected:',
      )
    ) {
      return {
        issue: 'invalid_url',
        title: 'Check the camera URL',
        fix: 'It must look like rtsp://user:pass@192.168.1.50:554/stream',
        detail: error,
        retryable: false,
      };
    }
    if (mentionsAny(error, 'invalid ip')) {
      return {
        issue: 'invalid_url',
        title: 'Check the IP address',
        fix: 'Enter a valid IPv4 address for the camera, e.g. 192.168.1.50',
        detail: error,
        retryable: false,
      };
    }

    // 401/403 from the media server means the camera rejected the credentials.
    if (mentionsAny(error, '401', '403', 'unauthor', 'forbidden', 'auth')) {
      return {
        issue: 'auth_failed',
        title: 'Camera rejected the username or password',
        fix: 'Re-enter the exact username and password from your camera app.',
        detail: error,
        retryable: false,
      };
    }

    // Timeout / ECONNREFUSED with no media server configured is the most common
    // real-world setup mistake: the phone cannot reach the camera directly and
    // there is no relay to fall back to.
    if (!mediaOk) {
      return {
        issue: 'media_server_down',
        title: 'No camera relay configured',
        fix: 'This app reaches cameras through a media server. Start it (server/api) and set EXPO_PUBLIC_MEDIA_SERVER_URL to your computer’s LAN IP, then rebuild.',
        detail: error,
        retryable: false,
      };
    }

    if (
      mentionsAny(
        error,
        'timeout',
        'timed out',
        'econnrefused',
        'network',
        'unreachable',
        'failed to fetch',
      )
    ) {
      return {
        issue: 'camera_unreachable',
        title: 'Camera not responding',
        fix: 'Make sure the phone and the camera are on the same Wi‑Fi network, and that the camera is powered on and streaming.',
        detail: error,
        retryable: true,
      };
    }

    if (mentionsAny(error, 'server error', '500', '502', '503', '404')) {
      return {
        issue: 'media_server_down',
        title: 'Media server could not start the stream',
        fix: 'Check that the media server (MediaMTX) is running and reachable, then try again.',
        detail: error,
        retryable: true,
      };
    }

    return {
      issue: 'unknown',
      title: 'Connection failed',
      fix: 'Check the camera URL, credentials, and that both devices are on the same network.',
      detail: error,
      retryable: true,
    };
  }

  return {
    issue: 'unknown',
    title: 'Camera connected',
    fix: 'Everything looks good.',
    retryable: false,
  };
}

/** Short status for the media server banner. */
export function mediaServerStatus(): {
  configured: boolean;
  url: string | null;
  label: string;
} {
  const raw = process.env.EXPO_PUBLIC_MEDIA_SERVER_URL?.trim();
  const configured = Boolean(raw);
  return {
    configured,
    url: configured ? raw! : null,
    label: configured
      ? `Camera relay: ${raw}`
      : 'Camera relay not configured — cameras will not connect until EXPO_PUBLIC_MEDIA_SERVER_URL is set.',
  };
}
