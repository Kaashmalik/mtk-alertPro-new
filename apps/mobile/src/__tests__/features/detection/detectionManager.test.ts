/**
 * Detection Manager Tests
 */

import {
  DetectionManager,
  type DetectionManagerConfig,
} from '@/features/detection/detectionManager';
import { createMockCamera } from '../../setup';

// Mock dependencies
jest.mock('@/features/detection/detectionService', () => ({
  detectionService: {
    initialize: jest.fn().mockResolvedValue(undefined),
    detect: jest.fn().mockResolvedValue([]),
    isInitialized: jest.fn().mockReturnValue(true),
    isBusy: jest.fn().mockReturnValue(false),
    getLastProcessTime: jest.fn().mockReturnValue(100),
    isInFallbackMode: jest.fn().mockReturnValue(false),
    retryModelLoad: jest.fn().mockResolvedValue(true),
    dispose: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@/features/detection/motionDetector', () => ({
  detectMotionBetweenFrames: jest
    .fn()
    .mockResolvedValue({ motion: false, score: 0 }),
}));

jest.mock('@/features/detection/frameCaptureService', () => ({
  frameCaptureService: {
    initialize: jest.fn().mockResolvedValue(undefined),
    startPeriodicCapture: jest.fn(),
    stopPeriodicCapture: jest.fn(),
    stopAllCaptures: jest.fn(),
    captureFrame: jest.fn().mockResolvedValue('/mock/frame.jpg'),
    deleteFrame: jest.fn().mockResolvedValue(true),
    dispose: jest.fn(),
  },
}));

jest.mock('@/lib/audio/alarmService', () => ({
  alarmService: {
    playAlarm: jest.fn().mockResolvedValue(undefined),
    stopAlarm: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@/lib/notifications/service', () => ({
  sendLocalNotification: jest.fn().mockResolvedValue('notification-id'),
}));

describe('Detection Manager', () => {
  let manager: DetectionManager;

  beforeEach(() => {
    jest.clearAllMocks();
    const {
      detectionService,
    } = require('@/features/detection/detectionService');
    detectionService.isInFallbackMode.mockReturnValue(false);
    const {
      detectMotionBetweenFrames,
    } = require('@/features/detection/motionDetector');
    detectMotionBetweenFrames.mockResolvedValue({ motion: false, score: 0 });
    manager = new DetectionManager({
      captureIntervalMs: 100,
      cooldownMs: 1000,
      minConfidence: 0.5,
    });
  });

  afterEach(async () => {
    await manager.dispose();
  });

  // =========================================================================
  // initialize
  // =========================================================================
  describe('initialize', () => {
    it('should initialize detection system', async () => {
      const {
        frameCaptureService,
      } = require('@/features/detection/frameCaptureService');
      const {
        detectionService,
      } = require('@/features/detection/detectionService');

      await manager.initialize();

      expect(frameCaptureService.initialize).toHaveBeenCalled();
      expect(detectionService.initialize).toHaveBeenCalled();
    });

    it('should throw if initialization fails', async () => {
      const {
        frameCaptureService,
      } = require('@/features/detection/frameCaptureService');
      frameCaptureService.initialize.mockRejectedValueOnce(
        new Error('Init failed'),
      );

      await expect(manager.initialize()).rejects.toThrow('Init failed');
    });
  });

  // =========================================================================
  // startMonitoring
  // =========================================================================
  describe('startMonitoring', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should start monitoring camera with detection enabled', async () => {
      const {
        frameCaptureService,
      } = require('@/features/detection/frameCaptureService');
      const camera = createMockCamera({
        detectionSettings: { person: true, vehicle: true },
      });

      await manager.startMonitoring(camera);

      expect(frameCaptureService.startPeriodicCapture).toHaveBeenCalledWith(
        camera.id,
        expect.any(Number),
        expect.any(Function),
      );
      expect(manager.isMonitoring()).toBe(true);
      expect(manager.getMonitoredCameraCount()).toBe(1);
    });

    it('should skip camera with no detection enabled', async () => {
      const {
        frameCaptureService,
      } = require('@/features/detection/frameCaptureService');
      const camera = createMockCamera({
        detectionSettings: { person: false, vehicle: false },
      });

      await manager.startMonitoring(camera);

      expect(frameCaptureService.startPeriodicCapture).not.toHaveBeenCalled();
      expect(manager.getMonitoredCameraCount()).toBe(0);
    });

    it('should not duplicate monitoring for same camera', async () => {
      const {
        frameCaptureService,
      } = require('@/features/detection/frameCaptureService');
      const camera = createMockCamera();

      await manager.startMonitoring(camera);
      await manager.startMonitoring(camera);

      expect(frameCaptureService.startPeriodicCapture).toHaveBeenCalledTimes(1);
    });

    it('should process a frame and notify when detection passes the threshold', async () => {
      const {
        frameCaptureService,
      } = require('@/features/detection/frameCaptureService');
      const {
        detectionService,
      } = require('@/features/detection/detectionService');
      const { sendLocalNotification } = require('@/lib/notifications/service');

      const camera = createMockCamera({
        detectionSettings: {
          person: true,
          vehicle: false,
          sensitivity: 0.5,
          alarmEnabled: false,
          notificationsEnabled: true,
        },
      });

      await manager.startMonitoring(camera);
      const captureCallback =
        frameCaptureService.startPeriodicCapture.mock.calls[0][2];

      detectionService.detect.mockResolvedValue([
        {
          type: 'person',
          confidence: 0.6,
          boundingBox: { x: 0, y: 0, width: 10, height: 10 },
        },
      ]);

      await captureCallback('/frame.jpg', new Date());

      expect(sendLocalNotification).toHaveBeenCalledTimes(1);
      expect(sendLocalNotification).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Person Detected' }),
      );
    });

    it('should apply refreshed settings to an already-monitored camera', async () => {
      const {
        frameCaptureService,
      } = require('@/features/detection/frameCaptureService');
      const {
        detectionService,
      } = require('@/features/detection/detectionService');
      const { sendLocalNotification } = require('@/lib/notifications/service');

      const camera = createMockCamera({
        detectionSettings: {
          person: true,
          vehicle: false,
          sensitivity: 0.5,
          alarmEnabled: false,
          notificationsEnabled: true,
        },
      });

      await manager.startMonitoring(camera);
      const captureCallback =
        frameCaptureService.startPeriodicCapture.mock.calls[0][2];

      // Coordinator re-syncs with stricter sensitivity after a settings change
      await manager.startMonitoring({
        ...camera,
        detectionSettings: { ...camera.detectionSettings, sensitivity: 0.9 },
      });

      // Refresh must not restart the capture loop
      expect(frameCaptureService.startPeriodicCapture).toHaveBeenCalledTimes(1);
      expect(manager.getMonitoredCameraCount()).toBe(1);

      detectionService.detect.mockResolvedValue([
        {
          type: 'person',
          confidence: 0.6,
          boundingBox: { x: 0, y: 0, width: 10, height: 10 },
        },
      ]);

      await captureCallback('/frame.jpg', new Date());

      // 0.6 < refreshed 0.9 threshold — stale settings would have notified
      expect(sendLocalNotification).not.toHaveBeenCalled();
    });

    it('should stop monitoring when all detection types are disabled on refresh', async () => {
      const camera = createMockCamera({
        detectionSettings: { person: true, vehicle: true },
      });

      await manager.startMonitoring(camera);
      expect(manager.getMonitoredCameraCount()).toBe(1);

      await manager.startMonitoring({
        ...camera,
        detectionSettings: {
          person: false,
          vehicle: false,
          face: false,
          animal: false,
          sensitivity: 0.7,
          notificationsEnabled: true,
          alarmEnabled: true,
        },
      });

      expect(manager.getMonitoredCameraCount()).toBe(0);
    });

    it('should still alert on motion when AI model is offline even if motion toggle is off', async () => {
      const {
        frameCaptureService,
      } = require('@/features/detection/frameCaptureService');
      const {
        detectionService,
      } = require('@/features/detection/detectionService');
      const {
        detectMotionBetweenFrames,
      } = require('@/features/detection/motionDetector');
      const { sendLocalNotification } = require('@/lib/notifications/service');

      // Home profile: person on, motion explicitly off
      const camera = createMockCamera({
        detectionSettings: {
          person: true,
          vehicle: false,
          motion: false,
          sensitivity: 0.65,
          alarmEnabled: false,
          notificationsEnabled: true,
        },
      });

      await manager.startMonitoring(camera);
      const captureCallback =
        frameCaptureService.startPeriodicCapture.mock.calls[0][2];

      // Offline: AI returns nothing, but pixel motion is detected
      detectionService.isInFallbackMode.mockReturnValue(true);
      detectionService.detect.mockResolvedValue([]);
      detectMotionBetweenFrames.mockResolvedValue({ motion: true, score: 0.5 });

      await captureCallback('/frame.jpg', new Date());

      expect(sendLocalNotification).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Motion Detected' }),
      );
    });

    it('should suppress motion alerts when AI is available and motion toggle is off', async () => {
      const {
        frameCaptureService,
      } = require('@/features/detection/frameCaptureService');
      const {
        detectionService,
      } = require('@/features/detection/detectionService');
      const {
        detectMotionBetweenFrames,
      } = require('@/features/detection/motionDetector');
      const { sendLocalNotification } = require('@/lib/notifications/service');

      const camera = createMockCamera({
        detectionSettings: {
          person: true,
          vehicle: false,
          motion: false,
          sensitivity: 0.65,
          alarmEnabled: false,
          notificationsEnabled: true,
        },
      });

      await manager.startMonitoring(camera);
      const captureCallback =
        frameCaptureService.startPeriodicCapture.mock.calls[0][2];

      detectionService.isInFallbackMode.mockReturnValue(false);
      detectionService.detect.mockResolvedValue([]);
      detectMotionBetweenFrames.mockResolvedValue({ motion: true, score: 0.9 });

      await captureCallback('/frame.jpg', new Date());

      expect(sendLocalNotification).not.toHaveBeenCalled();
    });

    it('should not motion-alert offline when the camera has no detection types enabled', async () => {
      const {
        detectionService,
      } = require('@/features/detection/detectionService');
      const {
        detectMotionBetweenFrames,
      } = require('@/features/detection/motionDetector');
      const { sendLocalNotification } = require('@/lib/notifications/service');

      const camera = createMockCamera({
        detectionSettings: {
          person: true,
          vehicle: false,
          face: false,
          animal: false,
          motion: false,
          sensitivity: 0.65,
          alarmEnabled: false,
          notificationsEnabled: true,
        },
      });

      await manager.startMonitoring(camera);
      expect(manager.getMonitoredCameraCount()).toBe(1);

      // All types get disabled after monitoring started
      await manager.startMonitoring({
        ...camera,
        detectionSettings: {
          person: false,
          vehicle: false,
          face: false,
          animal: false,
          motion: false,
          sensitivity: 0.65,
          notificationsEnabled: true,
          alarmEnabled: false,
        },
      });

      expect(manager.getMonitoredCameraCount()).toBe(0);
      expect(sendLocalNotification).not.toHaveBeenCalled();
      expect(detectMotionBetweenFrames).not.toHaveBeenCalled();
      expect(detectionService.detect).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // stopMonitoring
  // =========================================================================
  describe('stopMonitoring', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should stop monitoring specific camera', async () => {
      const {
        frameCaptureService,
      } = require('@/features/detection/frameCaptureService');
      const camera = createMockCamera();

      await manager.startMonitoring(camera);
      manager.stopMonitoring(camera.id);

      expect(frameCaptureService.stopPeriodicCapture).toHaveBeenCalledWith(
        camera.id,
      );
      expect(manager.getMonitoredCameraCount()).toBe(0);
    });

    it('should handle stopping non-existent camera', () => {
      // Should not throw
      expect(() => manager.stopMonitoring('non-existent')).not.toThrow();
    });
  });

  // =========================================================================
  // stopAll
  // =========================================================================
  describe('stopAll', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should stop all monitoring', async () => {
      const {
        frameCaptureService,
      } = require('@/features/detection/frameCaptureService');
      const cameras = [
        createMockCamera({ id: 'cam-1' }),
        createMockCamera({ id: 'cam-2' }),
      ];

      for (const camera of cameras) {
        await manager.startMonitoring(camera);
      }

      manager.stopAll();

      expect(frameCaptureService.stopAllCaptures).toHaveBeenCalled();
      expect(manager.isMonitoring()).toBe(false);
      expect(manager.getMonitoredCameraCount()).toBe(0);
    });
  });

  // =========================================================================
  // onDetection
  // =========================================================================
  describe('onDetection', () => {
    it('should register and call event handlers', async () => {
      const handler = jest.fn();

      const unsubscribe = manager.onDetection(handler);

      // Handler should be registered
      expect(typeof unsubscribe).toBe('function');
    });

    it('should unsubscribe handler', () => {
      const handler = jest.fn();

      const unsubscribe = manager.onDetection(handler);
      unsubscribe();

      // Should not throw after unsubscribe
      expect(() => unsubscribe()).not.toThrow();
    });
  });

  // =========================================================================
  // updateConfig
  // =========================================================================
  describe('updateConfig', () => {
    it('should update configuration', () => {
      const newConfig: Partial<DetectionManagerConfig> = {
        minConfidence: 0.8,
        cooldownMs: 60000,
      };

      manager.updateConfig(newConfig);

      const config = manager.getConfig();
      expect(config.minConfidence).toBe(0.8);
      expect(config.cooldownMs).toBe(60000);
    });

    it('should preserve unmodified settings', () => {
      const original = manager.getConfig();

      manager.updateConfig({ minConfidence: 0.9 });

      const updated = manager.getConfig();
      expect(updated.captureIntervalMs).toBe(original.captureIntervalMs);
      expect(updated.enableAlarm).toBe(original.enableAlarm);
    });
  });

  // =========================================================================
  // getMetrics
  // =========================================================================
  describe('getMetrics', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should return metrics', async () => {
      const camera = createMockCamera();
      await manager.startMonitoring(camera);

      const metrics = manager.getMetrics();

      expect(metrics.monitoredCameras).toBe(1);
      expect(typeof metrics.isProcessing).toBe('boolean');
      expect(typeof metrics.lastProcessTime).toBe('number');
    });
  });

  // =========================================================================
  // isDetectionReady
  // =========================================================================
  describe('isDetectionReady', () => {
    it('should return true when service is initialized', async () => {
      await manager.initialize();

      expect(manager.isDetectionReady()).toBe(true);
    });
  });

  // =========================================================================
  // getMonitoredCameraIds
  // =========================================================================
  describe('getMonitoredCameraIds', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should return list of monitored camera IDs', async () => {
      const cameras = [
        createMockCamera({ id: 'cam-1' }),
        createMockCamera({ id: 'cam-2' }),
      ];

      for (const camera of cameras) {
        await manager.startMonitoring(camera);
      }

      const ids = manager.getMonitoredCameraIds();

      expect(ids).toContain('cam-1');
      expect(ids).toContain('cam-2');
      expect(ids).toHaveLength(2);
    });
  });

  // =========================================================================
  // dispose
  // =========================================================================
  describe('dispose', () => {
    it('should dispose of all resources', async () => {
      const {
        frameCaptureService,
      } = require('@/features/detection/frameCaptureService');
      const {
        detectionService,
      } = require('@/features/detection/detectionService');

      await manager.initialize();
      await manager.dispose();

      expect(frameCaptureService.dispose).toHaveBeenCalled();
      expect(detectionService.dispose).toHaveBeenCalled();
    });

    it('should stop all monitoring on dispose', async () => {
      const {
        frameCaptureService,
      } = require('@/features/detection/frameCaptureService');
      const camera = createMockCamera();

      await manager.initialize();
      await manager.startMonitoring(camera);
      await manager.dispose();

      expect(frameCaptureService.stopAllCaptures).toHaveBeenCalled();
      expect(manager.isMonitoring()).toBe(false);
    });
  });
});
