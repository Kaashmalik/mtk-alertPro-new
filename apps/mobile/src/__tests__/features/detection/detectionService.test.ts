/**
 * Detection Service Tests — offline model fallback + recovery
 */

const tf = require('@tensorflow/tfjs');

jest.mock('@tensorflow/tfjs', () => ({
  ready: jest.fn().mockResolvedValue(undefined),
  getBackend: jest.fn().mockReturnValue('cpu'),
  setBackend: jest.fn().mockResolvedValue(undefined),
  loadGraphModel: jest.fn(),
  memory: jest.fn().mockReturnValue({ numTensors: 0 }),
  disposeVariables: jest.fn(),
}));

jest.mock('@react-native-community/netinfo', () => {
  let listener: ((state: unknown) => void) | null = null;
  return {
    addEventListener: jest.fn((cb: (state: unknown) => void) => {
      listener = cb;
      return jest.fn();
    }),
    fetch: jest.fn().mockResolvedValue({ isConnected: true }),
    __fireNetworkEvent: (state: unknown) => listener?.(state),
    __reset: () => {
      listener = null;
    },
  };
});

import { detectionService } from '@/features/detection/detectionService';

const NetInfo = require('@react-native-community/netinfo');

const mockModel = { dispose: jest.fn() };

describe('DetectionService offline fallback', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    NetInfo.__reset();
    tf.ready.mockResolvedValue(undefined);
    tf.getBackend.mockReturnValue('cpu');
    tf.loadGraphModel.mockResolvedValue(mockModel);
    await detectionService.dispose();
  });

  afterEach(async () => {
    await detectionService.dispose();
    jest.useRealTimers();
  });

  it('enters fallback mode when model load fails', async () => {
    tf.loadGraphModel.mockRejectedValueOnce(new Error('offline'));

    await detectionService.initialize();

    expect(detectionService.isInitialized()).toBe(true);
    expect(detectionService.isInFallbackMode()).toBe(true);
    const results = await detectionService.detect('/frame.jpg');
    expect(results).toEqual([]);
  });

  it('loads model successfully without fallback', async () => {
    await detectionService.initialize();

    expect(detectionService.isInFallbackMode()).toBe(false);
    expect(detectionService.isInitialized()).toBe(true);
  });

  it('retryModelLoad recovers from fallback when network is back', async () => {
    tf.loadGraphModel.mockRejectedValueOnce(new Error('offline'));
    await detectionService.initialize();
    expect(detectionService.isInFallbackMode()).toBe(true);

    // Second attempt succeeds (mock default resolves)
    const recovered = await detectionService.retryModelLoad();

    expect(recovered).toBe(true);
    expect(detectionService.isInFallbackMode()).toBe(false);
  });

  it('retryModelLoad is a no-op when model already loaded', async () => {
    await detectionService.initialize();
    expect(detectionService.isInFallbackMode()).toBe(false);

    tf.loadGraphModel.mockClear();
    const recovered = await detectionService.retryModelLoad();

    expect(recovered).toBe(true);
    expect(tf.loadGraphModel).not.toHaveBeenCalled();
  });

  it('NetInfo reconnect triggers automatic model retry', async () => {
    tf.loadGraphModel.mockRejectedValueOnce(new Error('offline'));
    await detectionService.initialize();
    expect(detectionService.isInFallbackMode()).toBe(true);
    expect(NetInfo.addEventListener).toHaveBeenCalled();

    // Reconnect — listener should kick off retry (default mock resolves)
    NetInfo.__fireNetworkEvent({
      isConnected: true,
      isInternetReachable: true,
    });
    await new Promise((r) => setTimeout(r, 20));

    expect(detectionService.isInFallbackMode()).toBe(false);
  });

  it('dispose clears fallback retry state', async () => {
    tf.loadGraphModel.mockRejectedValueOnce(new Error('offline'));
    await detectionService.initialize();
    expect(detectionService.isInFallbackMode()).toBe(true);

    await detectionService.dispose();

    expect(detectionService.isInitialized()).toBe(false);
    expect(detectionService.isInFallbackMode()).toBe(false);
  });
});
