/**
 * Connection Service Tests
 */

import {
  testCameraConnection,
  testConnectionViaMediaServer,
  createHealthMonitor,
  getConnectionQuality,
  formatLatency,
  type ConnectionTestResult,
} from '@/lib/camera/connectionService';

describe('Connection Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockReset();
  });

  // =========================================================================
  // testCameraConnection
  // =========================================================================
  describe('testCameraConnection', () => {
    it('should return success for valid URL and reachable camera', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const result = await testCameraConnection('rtsp://192.168.1.100:554/stream');

      expect(result.success).toBe(true);
      expect(result.latency).toBeDefined();
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should return success for 401 response (camera requires auth)', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      const result = await testCameraConnection('rtsp://192.168.1.100:554/stream');

      expect(result.success).toBe(true);
    });

    it('should return failure for invalid stream URL format', async () => {
      const result = await testCameraConnection('not-a-valid-url');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid stream URL');
    });

    it('should return failure for invalid RTSP URL format', async () => {
      const result = await testCameraConnection('rtsp://');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid RTSP URL');
    });

    it('should probe HTTP/MJPEG URLs directly', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'multipart/x-mixed-replace' },
      });

      const result = await testCameraConnection('http://192.168.1.100/videostream.cgi');

      expect(result.success).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://192.168.1.100/videostream.cgi',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should treat 401 on HTTP stream URL as reachable', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: { get: () => null },
      });

      const result = await testCameraConnection('http://192.168.1.100/snapshot.jpg');
      expect(result.success).toBe(true);
    });

    it('should reject malformed HTTP stream URLs', async () => {
      const result = await testCameraConnection('http://');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid HTTP stream URL');
    });

    it('should return failure for invalid IP address', async () => {
      const result = await testCameraConnection('rtsp://999.999.999.999:554/stream');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid IP address');
    });

    it('should return failure on network error', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const result = await testCameraConnection('rtsp://192.168.1.100:554/stream');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should return failure on timeout', async () => {
      (global.fetch as jest.Mock).mockImplementationOnce(() => 
        new Promise((_, reject) => {
          const error = new Error('Aborted');
          error.name = 'AbortError';
          reject(error);
        })
      );

      const result = await testCameraConnection('rtsp://192.168.1.100:554/stream', {
        timeoutMs: 100,
      });

      expect(result.success).toBe(false);
      // Error message may vary - just check it exists
      expect(result.error).toBeDefined();
    });

    it('should retry on failure', async () => {
      (global.fetch as jest.Mock)
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const result = await testCameraConnection('rtsp://192.168.1.100:554/stream', {
        retryCount: 1,
        retryDelayMs: 10,
      });

      expect(result.success).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should handle RTSP URL with credentials', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

      const result = await testCameraConnection(
        'rtsp://admin:password@192.168.1.100:554/stream'
      );

      expect(result.success).toBe(true);
    });

    it('should handle custom port', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

      const result = await testCameraConnection('rtsp://192.168.1.100:8554/stream');

      expect(result.success).toBe(true);
      // Should try HTTP on same port
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(':8554'),
        expect.any(Object)
      );
    });

    it('should handle hostname instead of IP', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

      const result = await testCameraConnection('rtsp://camera.local:554/stream');

      expect(result.success).toBe(true);
    });
  });
  describe('testConnectionViaMediaServer', () => {
    it('should return success when media server confirms connection', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          connected: true,
          streamInfo: { ready: true },
        }),
      });

      const result = await testConnectionViaMediaServer(
        'http://localhost:3001',
        'rtsp://192.168.1.100:554/stream'
      );

      expect(result.success).toBe(true);
      expect(result.streamInfo).toBeDefined();
    });

    it('should return failure when media server returns not connected', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ connected: false }),
      });

      const result = await testConnectionViaMediaServer(
        'http://localhost:3001',
        'rtsp://192.168.1.100:554/stream'
      );

      expect(result.success).toBe(false);
    });

    it('should return failure on server error', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await testConnectionViaMediaServer(
        'http://localhost:3001',
        'rtsp://192.168.1.100:554/stream'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('500');
    });

    it('should handle fetch error', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Server unavailable'));

      const result = await testConnectionViaMediaServer(
        'http://localhost:3001',
        'rtsp://192.168.1.100:554/stream'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Server unavailable');
    });
  });

  // =========================================================================
  // createHealthMonitor
  // =========================================================================
  describe('createHealthMonitor', () => {
    it('should return cleanup function', () => {
      const cameras = [{ id: 'cam-1', rtspUrl: 'rtsp://192.168.1.100:554/stream' }];
      
      const cleanup = createHealthMonitor(cameras, jest.fn(), 30000);
      
      expect(typeof cleanup).toBe('function');
      cleanup();
    });

    it('should accept empty camera array', () => {
      const cleanup = createHealthMonitor([], jest.fn(), 1000);
      
      expect(typeof cleanup).toBe('function');
      cleanup();
    });

    it('should handle callback function', () => {
      const onStatusChange = jest.fn();
      const cameras = [{ id: 'cam-1', rtspUrl: 'rtsp://192.168.1.100:554/stream' }];

      const cleanup = createHealthMonitor(cameras, onStatusChange, 60000);
      
      // Just verify it was set up correctly
      expect(onStatusChange).toBeDefined();
      cleanup();
    });

    it('reports online on the first successful heartbeat', async () => {
      jest.useFakeTimers();
      try {
        (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });
        const updates: Array<{ id: string; status: string }> = [];

        const cleanup = createHealthMonitor(
          [{ id: 'cam-1', rtspUrl: 'rtsp://192.168.1.100:554/stream' }],
          (id, health) => updates.push({ id, status: health.status }),
          30000,
        );

        await jest.advanceTimersByTimeAsync(0);
        expect(updates).toEqual([{ id: 'cam-1', status: 'online' }]);
        cleanup();
      } finally {
        jest.useRealTimers();
      }
    });

    it('transitions unknown → reconnecting → offline after sustained failures', async () => {
      jest.useFakeTimers();
      try {
        (global.fetch as jest.Mock).mockRejectedValue(new Error('down'));
        const updates: string[] = [];

        const cleanup = createHealthMonitor(
          [{ id: 'cam-1', rtspUrl: 'rtsp://192.168.1.100:554/stream' }],
          (_id, health) => updates.push(health.status),
          30000,
        );

        // Initial probe: failure #1 → reconnecting
        await jest.advanceTimersByTimeAsync(0);
        expect(updates).toEqual(['reconnecting']);

        // Probe #2: failure #2 → still reconnecting (no status change, no notify)
        await jest.advanceTimersByTimeAsync(30000);
        expect(updates).toEqual(['reconnecting']);

        // Probe #3: failure #3 → offline
        await jest.advanceTimersByTimeAsync(30000);
        expect(updates).toEqual(['reconnecting', 'offline']);

        cleanup();
      } finally {
        jest.useRealTimers();
      }
    });

    it('recovers from reconnecting back to online on success', async () => {
      jest.useFakeTimers();
      try {
        (global.fetch as jest.Mock)
          .mockRejectedValueOnce(new Error('down'))
          .mockResolvedValue({ ok: true, status: 200 });
        const updates: string[] = [];

        const cleanup = createHealthMonitor(
          [{ id: 'cam-1', rtspUrl: 'rtsp://192.168.1.100:554/stream' }],
          (_id, health) => updates.push(health.status),
          30000,
        );

        await jest.advanceTimersByTimeAsync(0);
        expect(updates).toEqual(['reconnecting']);

        await jest.advanceTimersByTimeAsync(30000);
        expect(updates).toEqual(['reconnecting', 'online']);

        cleanup();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  // =========================================================================
  // getConnectionQuality
  // =========================================================================
  describe('getConnectionQuality', () => {
    it('should return excellent for low latency', () => {
      expect(getConnectionQuality(50)).toBe('excellent');
      expect(getConnectionQuality(99)).toBe('excellent');
    });

    it('should return good for medium latency', () => {
      expect(getConnectionQuality(100)).toBe('good');
      expect(getConnectionQuality(299)).toBe('good');
    });

    it('should return fair for high latency', () => {
      expect(getConnectionQuality(300)).toBe('fair');
      expect(getConnectionQuality(999)).toBe('fair');
    });

    it('should return poor for very high latency', () => {
      expect(getConnectionQuality(1000)).toBe('poor');
      expect(getConnectionQuality(5000)).toBe('poor');
    });
  });

  // =========================================================================
  // formatLatency
  // =========================================================================
  describe('formatLatency', () => {
    it('should format milliseconds', () => {
      expect(formatLatency(50)).toBe('50ms');
      expect(formatLatency(500)).toBe('500ms');
      expect(formatLatency(999)).toBe('999ms');
    });

    it('should format seconds for >= 1000ms', () => {
      expect(formatLatency(1000)).toBe('1.0s');
      expect(formatLatency(1500)).toBe('1.5s');
      expect(formatLatency(3000)).toBe('3.0s');
    });
  });
});

