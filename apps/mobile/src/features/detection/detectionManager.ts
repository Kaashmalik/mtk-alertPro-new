/**
 * Detection Manager
 * Orchestrates detection across multiple cameras
 *
 * @module features/detection/detectionManager
 */

import { AnalyticsEvents, trackEvent } from '@/lib/analytics/events';
import { sendLocalNotification } from '@/lib/notifications/service';
import { reviewManager } from '@/lib/reviews/reviewManager';
import { canUseFeature, isTierActive } from '@/lib/subscription/planLimits';
import { supabase } from '@/lib/supabase/client';
import { toIsoString } from '@/lib/utils/date';
import { logError } from '@/lib/utils/errorHandler';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import {
  type Camera,
  DEFAULT_DETECTION_SETTINGS,
  type DetectionResult,
} from '@/types';
import * as FileSystem from 'expo-file-system/legacy';
import {
  identifyFromFile,
  isConfigured as isFaceModelConfigured,
} from '../faces';
import { markLocalAlert } from './alertDedup';
import { handleDetectionAlarm } from './detectionAlarmIntegration';
import { detectionService } from './detectionService';
import { frameCaptureService } from './frameCaptureService';
import { detectMotionBetweenFrames } from './motionDetector';
import { type DetectionEntitlements, shouldAlert } from './sceneProfiles';
import { isDetectionInZones } from './zoneFilter';

// ============================================================================
// Types
// ============================================================================

/**
 * Detection event that gets triggered when an object is detected
 */
export interface DetectionEvent {
  /** Camera that detected the object */
  cameraId: string;
  /** Camera name for display */
  cameraName: string;
  /** Type of detection */
  type: 'person' | 'vehicle' | 'face' | 'unknown' | 'motion' | 'animal';
  /** Detection confidence (0-1) */
  confidence: number;
  /** When the detection occurred */
  timestamp: Date;
  /** Path to the snapshot image */
  snapshotPath?: string;
  /** Matched known person when face recognition is enabled */
  personName?: string;
  /** Bounding box coordinates */
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * Detection manager configuration
 */
export interface DetectionManagerConfig {
  /** Frame capture interval in milliseconds */
  captureIntervalMs: number;
  /** Cooldown between alerts for same camera/type in milliseconds */
  cooldownMs: number;
  /** Minimum confidence to trigger alert (0-1) */
  minConfidence: number;
  /** Whether to play alarm sound */
  enableAlarm: boolean;
  /** Whether to send notifications */
  enableNotifications: boolean;
  /** Pixel-diff motion when AI returns empty */
  enableMotionFallback: boolean;
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CONFIG: DetectionManagerConfig = {
  captureIntervalMs: 1000, // Capture every 1 second
  cooldownMs: 30000, // 30 seconds between alerts per camera/type
  minConfidence: 0.65, // 65% confidence threshold (optimized)
  enableAlarm: true,
  enableNotifications: true,
  enableMotionFallback: true,
};

// ============================================================================
// Detection Manager
// ============================================================================

/**
 * Detection Manager
 * Coordinates detection across multiple cameras
 */
class DetectionManager {
  private config: DetectionManagerConfig;
  private activeCameras: Map<string, Camera> = new Map();
  private lastAlertTime: Map<string, number> = new Map();
  private prevFrames: Map<string, string> = new Map();
  private isRunning = false;
  private eventHandlers: Set<(event: DetectionEvent) => void> = new Set();
  private alertCreateQueue: DetectionEvent[] = [];
  private isProcessingQueue = false;

  constructor(config: Partial<DetectionManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private hasAnyDetectionEnabled(s: Camera['detectionSettings']): boolean {
    // `face` only counts when the plan includes it, otherwise a camera whose
    // only toggle is face would keep the detection loop alive on a free tier
    // while never producing a single alert.
    const faceUsable =
      s.face === true && this.detectionEntitlements().face !== false;
    return Boolean(
      s.person || s.vehicle || faceUsable || s.animal || s.motion === true,
    );
  }

  /**
   * Plan entitlements applied to detections.
   *
   * Resolved from the subscription store on every call rather than cached: a
   * zustand getState() is a cheap synchronous read, and caching it here would
   * keep a lapsed subscription's face access alive for the life of the manager
   * (which lives as long as the app). `isTierActive` also re-reads the clock, so
   * an expired plan downgrades mid-session without a restart.
   */
  private detectionEntitlements(): DetectionEntitlements {
    const { currentTier, expiresAt } = useSubscriptionStore.getState();
    const effective = isTierActive(currentTier, expiresAt)
      ? currentTier
      : 'free';
    return { face: canUseFeature(effective, 'hasFaceRecognition') };
  }

  /**
   * Initialize the detection system
   */
  async initialize(): Promise<void> {
    console.log('[DetectionManager] Initializing...');

    try {
      // Initialize frame capture service
      await frameCaptureService.initialize();

      // Initialize detection service (loads AI model)
      await detectionService.initialize();

      console.log('[DetectionManager] Initialization complete');
    } catch (error) {
      console.error('[DetectionManager] Initialization failed:', error);
      logError(error, 'DetectionManager.initialize');
      throw error;
    }
  }

  /**
   * Start monitoring a camera for detections
   *
   * @param camera - Camera to monitor
   */
  async startMonitoring(camera: Camera): Promise<void> {
    const armed = useSettingsStore.getState().detection.armed ?? true;
    if (!armed) {
      console.log('[DetectionManager] System disarmed — skip monitoring');
      return;
    }

    // Check if detection is enabled for this camera
    if (!this.hasAnyDetectionEnabled(camera.detectionSettings)) {
      // If it was monitored under older settings, stop it so the disabled
      // toggles actually take effect.
      if (this.activeCameras.has(camera.id)) {
        this.stopMonitoring(camera.id);
      }
      console.log(
        `[DetectionManager] Camera ${camera.name} has no detection enabled, skipping`,
      );
      return;
    }

    // Already monitoring: refresh the stored camera so settings changes
    // (scene profile, type toggles, sensitivity, cooldown) apply to the next
    // frame instead of being stuck with the snapshot taken at first start.
    if (this.activeCameras.has(camera.id)) {
      this.activeCameras.set(camera.id, camera);
      console.log(
        `[DetectionManager] Refreshed detection settings for: ${camera.name}`,
      );
      return;
    }

    console.log(
      `[DetectionManager] Starting monitoring for camera: ${camera.name}`,
    );

    // Store camera
    this.activeCameras.set(camera.id, camera);

    // Start periodic frame capture and detection.
    // Always read the camera from the map (never close over the start-time
    // object) so refreshed settings are used on every frame.
    frameCaptureService.startPeriodicCapture(
      camera.id,
      this.config.captureIntervalMs,
      async (framePath, timestamp) => {
        const current = this.activeCameras.get(camera.id);
        if (!current) return;
        await this.processFrame(current, framePath, timestamp);
      },
    );

    this.isRunning = true;
  }

  /**
   * Stop monitoring a specific camera
   *
   * @param cameraId - Camera ID to stop monitoring
   */
  stopMonitoring(cameraId: string): void {
    const camera = this.activeCameras.get(cameraId);

    if (camera) {
      console.log(
        `[DetectionManager] Stopping monitoring for camera: ${camera.name}`,
      );
      frameCaptureService.stopPeriodicCapture(cameraId);
      this.activeCameras.delete(cameraId);
    }

    // Update running state
    if (this.activeCameras.size === 0) {
      this.isRunning = false;
    }
  }

  /**
   * Stop all monitoring
   */
  stopAll(): void {
    console.log('[DetectionManager] Stopping all monitoring');

    frameCaptureService.stopAllCaptures();
    this.activeCameras.clear();
    this.lastAlertTime.clear();
    this.prevFrames.clear();
    this.isRunning = false;
  }

  /**
   * Process a captured frame for detections
   */
  private async processFrame(
    camera: Camera,
    framePath: string,
    timestamp: Date,
  ): Promise<void> {
    if (!(useSettingsStore.getState().detection.armed ?? true)) {
      return;
    }

    try {
      let detections = await detectionService.detect(framePath);

      // Zone sensitivity is judged against the model's score, so pair the box
      // with its confidence rather than letting the filter assume a perfect 1.0.
      detections = detections.filter((d) =>
        isDetectionInZones(
          d.boundingBox
            ? { ...d.boundingBox, confidence: d.confidence }
            : undefined,
          camera.detectionSettings.zones,
        ),
      );

      const entitlements = this.detectionEntitlements();

      const validDetections = detections.filter((detection) => {
        const threshold =
          camera.detectionSettings.sensitivity || this.config.minConfidence;
        if (detection.confidence < threshold) {
          return false;
        }
        // Scene profile / type allow-list (farm suppresses animals, shop focuses on people, etc.)
        return shouldAlert(detection, camera.detectionSettings, entitlements);
      });

      if (validDetections.length === 0 && this.config.enableMotionFallback) {
        const aiUnavailable = detectionService.isInFallbackMode();

        // Respect scene motion toggle (home/farm/shop suppress loose motion),
        // but when the AI model is unavailable (offline), pixel motion is the
        // only remaining signal — don't let motion:false mute alerts entirely.
        const motionAllowed =
          camera.detectionSettings.motion === true ||
          (aiUnavailable &&
            this.hasAnyDetectionEnabled(camera.detectionSettings));

        if (!motionAllowed) {
          const stalePrev = this.prevFrames.get(camera.id);
          this.prevFrames.set(camera.id, framePath);
          if (stalePrev && stalePrev !== framePath) {
            await frameCaptureService.deleteFrame(stalePrev).catch(() => {});
          }
          return;
        }

        const prev = this.prevFrames.get(camera.id) || null;
        const motion = await detectMotionBetweenFrames(prev, framePath);
        this.prevFrames.set(camera.id, framePath);
        if (motion.motion) {
          await this.handleDetection(
            camera,
            { type: 'unknown', confidence: motion.score },
            framePath,
            timestamp,
            'motion',
          );
        } else if (prev && prev !== framePath) {
          await frameCaptureService.deleteFrame(prev).catch(() => {});
        }
        return;
      }

      this.prevFrames.set(camera.id, framePath);

      for (const detection of validDetections) {
        await this.handleDetection(camera, detection, framePath, timestamp);
      }

      if (validDetections.length === 0) {
        await frameCaptureService.deleteFrame(framePath);
      }
    } catch (error) {
      console.error('[DetectionManager] Frame processing error:', error);
      logError(error, 'DetectionManager.processFrame');
    }
  }

  /**
   * Handle a valid detection
   */
  private async handleDetection(
    camera: Camera,
    detection: DetectionResult,
    snapshotPath: string,
    timestamp: Date,
    forceType?: 'motion',
  ): Promise<void> {
    const eventType = forceType || detection.type;
    const cooldownKey = `${camera.id}_${eventType}`;
    const now = Date.now();
    const lastAlert = this.lastAlertTime.get(cooldownKey) || 0;

    const redAlert = useSettingsStore.getState().detection.redAlertMode;
    // handleDetection has no top-level try/catch, so a null detectionSettings
    // here would become an unhandled rejection and silently kill detection.
    const detectionSettings =
      camera.detectionSettings ?? DEFAULT_DETECTION_SETTINGS;
    const settingsCooldown = (detectionSettings.cooldownSeconds || 30) * 1000;
    const cooldown = redAlert
      ? Math.min(settingsCooldown, this.config.cooldownMs, 10000)
      : Math.min(settingsCooldown, this.config.cooldownMs * 2);

    if (now - lastAlert < cooldown) {
      console.log(
        `[DetectionManager] Cooldown active for ${camera.name} - ${eventType}`,
      );
      return;
    }

    this.lastAlertTime.set(cooldownKey, now);
    markLocalAlert(
      camera.id,
      eventType === 'unknown' ? 'motion' : String(eventType),
    );

    console.log(
      `[DetectionManager] Detection: ${eventType} (${Math.round(detection.confidence * 100)}%) on ${camera.name}`,
    );

    const detectedPersonName =
      eventType === 'person' &&
      detectionSettings.face === true &&
      this.detectionEntitlements().face === true &&
      isFaceModelConfigured()
        ? (await identifyFromFile(snapshotPath).catch(() => null))?.name
        : undefined;

    const event: DetectionEvent = {
      cameraId: camera.id,
      cameraName: camera.name,
      type: (eventType === 'unknown'
        ? 'motion'
        : eventType) as DetectionEvent['type'],
      confidence: detection.confidence,
      timestamp,
      snapshotPath,
      boundingBox: detection.boundingBox,
      personName: detectedPersonName,
    };

    trackEvent(AnalyticsEvents.DETECT_HIT, {
      cameraId: camera.id,
      type: event.type,
      confidence: detection.confidence,
    });

    reviewManager.onHappyMoment('alert-detected');

    this.eventHandlers.forEach((handler) => {
      try {
        handler(event);
      } catch (error) {
        console.error('[DetectionManager] Event handler error:', error);
      }
    });

    if (camera.detectionSettings.alarmEnabled !== false) {
      try {
        await handleDetectionAlarm(
          forceType === 'motion'
            ? [
                {
                  type: 'person',
                  confidence: Math.max(0.6, detection.confidence),
                },
              ]
            : [detection],
          camera.id,
        );
        trackEvent(AnalyticsEvents.ALARM_PLAY, {
          cameraId: camera.id,
          type: event.type,
        });
      } catch (error) {
        console.error('[DetectionManager] Alarm integration error:', error);
      }
    }

    if (
      this.config.enableNotifications &&
      camera.detectionSettings.notificationsEnabled !== false
    ) {
      try {
        const label =
          event.type === 'person'
            ? 'Person'
            : event.type === 'vehicle'
              ? 'Vehicle'
              : event.type === 'face'
                ? 'Face'
                : event.type === 'animal'
                  ? 'Animal'
                  : 'Motion';
        await sendLocalNotification({
          title: event.personName
            ? `${event.personName} spotted`
            : `${label} Detected`,
          body: event.personName
            ? `${camera.name} - known person recognized (${Math.round(detection.confidence * 100)}% confidence)`
            : `${camera.name} - ${Math.round(detection.confidence * 100)}% confidence`,
          data: {
            cameraId: camera.id,
            detectionType: event.type,
            personName: event.personName,
          },
        });
      } catch (error) {
        console.error('[DetectionManager] Notification error:', error);
      }
    }

    this.queueAlertCreation(event, camera.userId);
  }

  /**
   * Queue alert creation to avoid blocking detection
   */
  private queueAlertCreation(event: DetectionEvent, userId: string): void {
    this.alertCreateQueue.push(event);

    if (!this.isProcessingQueue) {
      this.processAlertQueue(userId);
    }
  }

  private async uploadSnapshot(
    localPath: string,
    userId: string,
    cameraId: string,
  ): Promise<string | null> {
    try {
      const info = await FileSystem.getInfoAsync(localPath);
      if (!info.exists) return null;

      const storagePath = `${userId}/${cameraId}/${Date.now()}.jpg`;
      const base64 = await FileSystem.readAsStringAsync(localPath, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const { error } = await supabase.storage
        .from('alert-snapshots')
        .upload(storagePath, bytes.buffer, {
          contentType: 'image/jpeg',
          upsert: false,
        });

      if (error) {
        console.warn(
          '[DetectionManager] Snapshot upload failed:',
          error.message,
        );
        return null;
      }

      const { data } = supabase.storage
        .from('alert-snapshots')
        .getPublicUrl(storagePath);
      return data.publicUrl;
    } catch (e) {
      console.warn('[DetectionManager] Snapshot upload error:', e);
      return null;
    }
  }

  /**
   * Process the alert creation queue
   */
  private async processAlertQueue(userId: string): Promise<void> {
    if (this.isProcessingQueue) return;

    this.isProcessingQueue = true;

    while (this.alertCreateQueue.length > 0) {
      const event = this.alertCreateQueue.shift();
      if (!event) continue;

      try {
        let snapshotUrl: string | undefined;
        if (event.snapshotPath) {
          snapshotUrl =
            (await this.uploadSnapshot(
              event.snapshotPath,
              userId,
              event.cameraId,
            )) || undefined;
        }

        const { error } = await supabase.from('alerts').insert({
          camera_id: event.cameraId,
          user_id: userId,
          type: event.type === 'unknown' ? 'motion' : event.type,
          confidence: event.confidence,
          snapshot_url: snapshotUrl,
          metadata: {
            boundingBox: event.boundingBox,
            processedAt: toIsoString(event.timestamp) ?? undefined,
            personName: event.personName,
          },
          is_read: false,
        });

        if (error) {
          console.error('[DetectionManager] Failed to create alert:', error);
        }
      } catch (error) {
        console.error('[DetectionManager] Alert creation error:', error);
      }
    }

    this.isProcessingQueue = false;
  }

  /**
   * Register a callback for detection events
   */
  onDetection(handler: (event: DetectionEvent) => void): () => void {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  updateConfig(config: Partial<DetectionManagerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): DetectionManagerConfig {
    return { ...this.config };
  }

  isMonitoring(): boolean {
    return this.isRunning;
  }

  getMonitoredCameraCount(): number {
    return this.activeCameras.size;
  }

  getMonitoredCameraIds(): string[] {
    return Array.from(this.activeCameras.keys());
  }

  isDetectionReady(): boolean {
    return detectionService.isInitialized();
  }

  getMetrics(): {
    monitoredCameras: number;
    isProcessing: boolean;
    lastProcessTime: number;
  } {
    return {
      monitoredCameras: this.activeCameras.size,
      isProcessing: detectionService.isBusy(),
      lastProcessTime: detectionService.getLastProcessTime(),
    };
  }

  async dispose(): Promise<void> {
    this.stopAll();
    this.eventHandlers.clear();
    frameCaptureService.dispose();
    await detectionService.dispose();
  }
}

export const detectionManager = new DetectionManager();
export { DetectionManager };
