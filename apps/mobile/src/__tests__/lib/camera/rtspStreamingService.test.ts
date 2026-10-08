/**
 * RTSPStreamingService Tests
 * Focus: bounded exponential backoff reconnection, state machine, URL validation.
 *
 * The transport layer (`connectToRTSPStream`) is spied out — in Jest,
 * `process.env.EXPO_PUBLIC_*` is inlined at transform time and
 * `react-native-ffmpeg` isn't installed, so the real transport is not
 * exercisable here. These tests cover the connection lifecycle logic.
 */

import {
  RTSPStreamingService,
  type StreamConfig,
  type StreamStatus,
  buildFfmpegHlsCommand,
} from '@/lib/camera/rtspStreamingService';

type ConnectResult = {
  success: boolean;
  quality?: StreamStatus['quality'];
  bitrate?: number;
  fps?: number;
  width?: number;
  height?: number;
  codec?: string;
  error?: string;
};

const SUCCESS: ConnectResult = {
  success: true,
  quality: 'good',
  bitrate: 2000000,
  fps: 30,
  width: 1920,
  height: 1080,
  codec: 'H264',
};

const FAILURE: ConnectResult = { success: false, error: 'network down' };

const makeConfig = (overrides: Partial<StreamConfig> = {}): StreamConfig => ({
  url: 'rtsp://192.168.1.100:554/stream',
  timeoutMs: 100,
  maxRetries: 3,
  reconnectIntervalMs: 1000,
  maxReconnectDelayMs: 30000,
  ...overrides,
});

// Created fresh in beforeEach — jest config `restoreMocks: true` detaches any
// spy created at module load before the first test runs.
let transportSpy: jest.SpyInstance;

describe('RTSPStreamingService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Deterministic jitter: 0.8 + 0.5 * 0.4 = 1.0 → exact exponential delays
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    transportSpy = jest.spyOn(
      RTSPStreamingService.prototype as any,
      'connectToRTSPStream',
    );
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('URL validation', () => {
    it('accepts raw IP-based RTSP URLs', async () => {
      transportSpy.mockResolvedValue(SUCCESS);

      const svc = new RTSPStreamingService(makeConfig());
      const status = await svc.connect();

      expect(transportSpy).toHaveBeenCalledTimes(1);
      expect(status.state).toBe('connected');
      expect(status.error).toBeNull();
      svc.disconnect();
    });

    it('fails fast on malformed URLs without scheduling retries', async () => {
      const svc = new RTSPStreamingService(makeConfig({ url: 'not-a-url' }));
      const status = await svc.connect();

      expect(status.state).toBe('offline');
      expect(status.error).toBe('Invalid RTSP URL format');
      expect(transportSpy).not.toHaveBeenCalled();
      // No pending reconnect timers for config errors
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('buildFfmpegHlsCommand (argv layout)', () => {
    const base = {
      url: 'rtsp://192.168.1.100:554/stream',
      outputPath: '/cache/stream.m3u8',
      segmentPattern: '/cache/segment_%03d.ts',
    };

    it('keeps -i at its own index with the URL as the following value', () => {
      const argv = buildFfmpegHlsCommand(base);

      // Regression: auth injection used to overwrite argv[2] ('-i') with the URL
      expect(argv[2]).toBe('-i');
      expect(argv[3]).toBe(base.url);
      expect(argv[0]).toBe('-rtsp_transport');
      expect(argv[1]).toBe('tcp');
    });

    it('never embeds credentials into the URL even when supplied', () => {
      const argv = buildFfmpegHlsCommand({
        ...base,
        username: 'admin',
        password: 'p@ss',
      });

      expect(argv[2]).toBe('-i');
      expect(argv[3]).toBe(base.url);
      // No userinfo anywhere in the argv
      expect(argv.some((a) => /^rtsp:\/\/[^@/]*@/.test(a))).toBe(false);
      expect(argv.join(' ')).not.toContain('p@ss');
    });

    it('sanitizes a legacy credential-bearing URL defensively', () => {
      const argv = buildFfmpegHlsCommand({
        url: 'rtsp://admin:secret@192.168.1.100:554/stream',
        outputPath: base.outputPath,
        segmentPattern: base.segmentPattern,
      });

      expect(argv[3]).toBe('rtsp://192.168.1.100:554/stream');
      expect(argv.join(' ')).not.toContain('secret');
      expect(argv.join(' ')).not.toContain('@');
    });

    it('still includes -f hls and the output path as the final token', () => {
      const argv = buildFfmpegHlsCommand(base);
      expect(argv).toContain('-f');
      expect(argv[argv.indexOf('-f') + 1]).toBe('hls');
      expect(argv[argv.length - 1]).toBe(base.outputPath);
    });

    it('emits exactly one argv entry per token (no accidental splitting)', () => {
      const argv = buildFfmpegHlsCommand(base);
      expect(argv.filter((a) => a === base.url)).toHaveLength(1);
    });
  });

  describe('exponential backoff reconnection', () => {
    it('retries with doubling delays, then stops at maxRetries (no infinite spam)', async () => {
      transportSpy.mockResolvedValue(FAILURE);
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      const svc = new RTSPStreamingService(makeConfig());
      const states: StreamStatus['state'][] = [];
      svc.onStatusChange((s) => states.push(s.state));

      await svc.connect();
      // Initial attempt failed → first retry scheduled at base * 2^0 = 1000ms
      expect(svc.getStatus().state).toBe('reconnecting');
      expect(setTimeoutSpy).toHaveBeenLastCalledWith(
        expect.any(Function),
        1000,
      );

      await jest.advanceTimersByTimeAsync(1000);
      // Second failure → base * 2^1 = 2000ms
      expect(setTimeoutSpy).toHaveBeenLastCalledWith(
        expect.any(Function),
        2000,
      );

      await jest.advanceTimersByTimeAsync(2000);
      // Third failure → base * 2^2 = 4000ms
      expect(setTimeoutSpy).toHaveBeenLastCalledWith(
        expect.any(Function),
        4000,
      );

      await jest.advanceTimersByTimeAsync(4000);

      // maxRetries = 3 → initial + 3 retries = 4 attempts, then terminal offline
      expect(transportSpy).toHaveBeenCalledTimes(4);
      const final = svc.getStatus();
      expect(final.state).toBe('offline');
      expect(final.error).toContain('gave up after 3 retry attempts');

      // Advance far beyond any backoff window — no further attempts
      await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(transportSpy).toHaveBeenCalledTimes(4);

      expect(states).toContain('reconnecting');
      expect(states[states.length - 1]).toBe('offline');

      svc.disconnect();
    });

    it('caps each delay at maxReconnectDelayMs', async () => {
      transportSpy.mockResolvedValue(FAILURE);
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      const svc = new RTSPStreamingService(
        makeConfig({
          maxRetries: 4,
          reconnectIntervalMs: 10000,
          maxReconnectDelayMs: 15000,
        }),
      );

      await svc.connect(); // → 10000
      await jest.advanceTimersByTimeAsync(10000);
      // 10000 * 2 = 20000 → capped to 15000
      expect(setTimeoutSpy).toHaveBeenLastCalledWith(
        expect.any(Function),
        15000,
      );

      svc.disconnect();
      await jest.advanceTimersByTimeAsync(60000);
    });

    it('resets the backoff counter after a successful reconnect', async () => {
      transportSpy
        .mockResolvedValueOnce(FAILURE)
        .mockResolvedValueOnce(SUCCESS);

      const svc = new RTSPStreamingService(makeConfig());
      await svc.connect();
      expect(svc.getStatus().state).toBe('reconnecting');
      expect(svc.getStatus().reconnectAttempts).toBe(1);

      await jest.advanceTimersByTimeAsync(1000);
      const status = svc.getStatus();
      expect(status.state).toBe('connected');
      expect(status.reconnectAttempts).toBe(0);

      svc.disconnect();
    });

    it('disconnect() cancels pending reconnects', async () => {
      transportSpy.mockResolvedValue(FAILURE);

      const svc = new RTSPStreamingService(makeConfig());
      await svc.connect();
      expect(svc.getStatus().state).toBe('reconnecting');

      svc.disconnect();
      expect(svc.getStatus().state).toBe('idle');
      expect(jest.getTimerCount()).toBe(0);

      await jest.advanceTimersByTimeAsync(60000);
      expect(transportSpy).toHaveBeenCalledTimes(1);
    });

    it('retry() restarts a fresh backoff cycle after giving up', async () => {
      transportSpy
        .mockResolvedValueOnce(FAILURE)
        .mockResolvedValueOnce(FAILURE)
        .mockResolvedValueOnce(SUCCESS);

      const svc = new RTSPStreamingService(makeConfig({ maxRetries: 1 }));
      await svc.connect();
      await jest.advanceTimersByTimeAsync(1000);
      expect(svc.getStatus().state).toBe('offline');

      const status = await svc.retry();
      expect(status.state).toBe('connected');

      svc.disconnect();
    });

    it('ignores concurrent connect() calls while one is in flight', async () => {
      let resolveConnect: (r: ConnectResult) => void = () => {};
      transportSpy.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveConnect = resolve;
          }),
      );

      const svc = new RTSPStreamingService(makeConfig());
      const first = svc.connect();
      const second = svc.connect(); // no-op while in flight
      expect(svc.getStatus().state).toBe('connecting');

      resolveConnect(SUCCESS);
      const [a, b] = await Promise.all([first, second]);

      expect(transportSpy).toHaveBeenCalledTimes(1);
      expect(a.state).toBe('connected');
      // Second call returned a snapshot taken while the first was in flight
      expect(b.state).toBe('connecting');

      svc.disconnect();
    });
  });
});
