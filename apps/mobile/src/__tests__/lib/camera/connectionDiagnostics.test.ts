/**
 * Connection diagnostics.
 *
 * The user's report was "no camera connection" with no actionable information.
 * These lock the classification that turns a low-level failure into a specific
 * cause + fix, especially the most common one: the media relay is not configured.
 */

import {
  diagnoseConnection,
  isMediaServerConfigured,
  mediaServerStatus,
} from '@/lib/camera/connectionDiagnostics';
import type { ConnectionTestResult } from '@/lib/camera/connectionService';

const fail = (error: string): ConnectionTestResult => ({
  success: false,
  error,
  timestamp: new Date(),
});

const ok: ConnectionTestResult = {
  success: true,
  latency: 42,
  timestamp: new Date(),
};

describe('diagnoseConnection', () => {
  it('blames the missing relay when nothing is configured', () => {
    // The single most common real cause, and previously reported as a raw
    // network error the user could not act on.
    const d = diagnoseConnection(fail('fetch failed'), {
      mediaServerConfigured: false,
    });
    expect(d.issue).toBe('media_server_down');
    expect(d.title).toMatch(/relay/i);
    expect(d.retryable).toBe(false);
  });

  it('blames the camera when the relay exists but cannot reach it', () => {
    const d = diagnoseConnection(fail('Request timed out'), {
      mediaServerConfigured: true,
    });
    expect(d.issue).toBe('camera_unreachable');
    expect(d.retryable).toBe(true);
    expect(d.fix).toMatch(/same/i); // same network
  });

  it('detects bad credentials from 401/403', () => {
    const d = diagnoseConnection(fail('Server error: 401 Unauthorized'), {
      mediaServerConfigured: true,
    });
    expect(d.issue).toBe('auth_failed');
    expect(d.retryable).toBe(false);
  });

  it('detects a malformed URL and does not suggest a blind retry', () => {
    const d = diagnoseConnection(
      fail('Invalid RTSP URL format. Expected: rtsp://...'),
      { mediaServerConfigured: true },
    );
    expect(d.issue).toBe('invalid_url');
    expect(d.retryable).toBe(false);
  });

  it('detects an invalid IP', () => {
    const d = diagnoseConnection(fail('Invalid IP address: 999.1.1.1'), {
      mediaServerConfigured: true,
    });
    expect(d.issue).toBe('invalid_url');
    expect(d.fix).toMatch(/IP/i);
  });

  it('treats a relay 5xx as retryable', () => {
    const d = diagnoseConnection(fail('Server error: 502'), {
      mediaServerConfigured: true,
    });
    expect(d.issue).toBe('media_server_down');
    expect(d.retryable).toBe(true);
  });

  it('falls back to a generic diagnosis but keeps the raw error', () => {
    const d = diagnoseConnection(fail('something odd happened'), {
      mediaServerConfigured: true,
    });
    expect(d.issue).toBe('unknown');
    expect(d.detail).toBe('something odd happened');
  });

  it('reports success without a fix prompt', () => {
    const d = diagnoseConnection(ok, { mediaServerConfigured: true });
    expect(d.title).toMatch(/connected/i);
  });
});

describe('media server status', () => {
  it('reports unconfigured when the env var is absent', () => {
    // The test env does not set it, which mirrors a fresh clone.
    expect(isMediaServerConfigured()).toBe(false);
    const s = mediaServerStatus();
    expect(s.configured).toBe(false);
    expect(s.label).toMatch(/not configured/i);
  });
});
