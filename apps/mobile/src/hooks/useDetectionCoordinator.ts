/**
 * Detection Coordinator Hook
 * Synchronizes cameras, Arm/Red Alert, and detectionManager.
 * Alarm + local notification are owned solely by detectionManager (no double ring).
 */

import { detectionManager } from '@/features/detection/detectionManager';
import type { DetectionEvent } from '@/features/detection/detectionManager';
import { AnalyticsEvents, trackEvent } from '@/lib/analytics/events';
import { useAlertStore, useCameraStore, useSettingsStore } from '@/stores';
import { useCallback, useEffect, useRef, useState } from 'react';

export function useDetectionCoordinator() {
  const cameras = useCameraStore((state) => state.cameras);
  const redAlertMode = useSettingsStore(
    (state) => state.detection.redAlertMode,
  );
  const armed = useSettingsStore((state) => state.detection.armed ?? true);
  const setDetection = useSettingsStore((state) => state.setDetection);
  const addAlert = useAlertStore((state) => state.addAlert);

  const [isReady, setIsReady] = useState(false);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const handleDetectionEvent = useCallback(
    async (event: DetectionEvent) => {
      // UI store only — manager already alarms + notifies + inserts DB
      try {
        const alertType =
          event.type === 'unknown'
            ? 'motion'
            : event.type === 'motion'
              ? 'motion'
              : event.type;
        await addAlert({
          cameraId: event.cameraId,
          cameraName: event.cameraName,
          type: alertType as 'person' | 'vehicle' | 'face' | 'motion',
          confidence: event.confidence,
          timestamp: event.timestamp || new Date(),
          isRead: false,
          snapshotUrl: event.snapshotPath,
          skipPersist: true,
        });
      } catch (err) {
        console.warn(
          '[DetectionCoordinator] Failed to add alert to store:',
          err,
        );
      }
    },
    [addAlert],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally keyed to subscription setup only
  useEffect(() => {
    let isCancelled = false;

    async function syncDetection() {
      if (!unsubscribeRef.current) {
        unsubscribeRef.current =
          detectionManager.onDetection(handleDetectionEvent);
      }

      if (!armed) {
        detectionManager.stopAll();
        setIsMonitoring(false);
        return;
      }

      const targetCameras = cameras.filter((cam) => {
        if (!cam.isActive) return false;
        if (redAlertMode) return true;
        const ds = cam.detectionSettings;
        return Boolean(
          ds?.person || ds?.vehicle || ds?.face || ds?.animal || ds?.motion,
        );
      });

      if (targetCameras.length === 0) {
        if (isMonitoring) {
          detectionManager.stopAll();
          setIsMonitoring(false);
        }
        return;
      }

      try {
        await detectionManager.initialize();
        if (isCancelled) return;
        setIsReady(true);

        // Refresh monitored set
        const desiredIds = new Set(targetCameras.map((c) => c.id));
        for (const id of detectionManager.getMonitoredCameraIds()) {
          if (!desiredIds.has(id)) detectionManager.stopMonitoring(id);
        }

        for (const camera of targetCameras) {
          const effectiveCamera = {
            ...camera,
            detectionSettings: {
              ...camera.detectionSettings,
              person: redAlertMode ? true : camera.detectionSettings.person,
              vehicle: redAlertMode ? true : camera.detectionSettings.vehicle,
              sensitivity: redAlertMode
                ? 0.5
                : camera.detectionSettings.sensitivity || 0.65,
            },
          };
          await detectionManager.startMonitoring(effectiveCamera);
        }

        setIsMonitoring(true);
      } catch (error) {
        console.warn('[DetectionCoordinator] Detection sync warning:', error);
      }
    }

    syncDetection();

    return () => {
      isCancelled = true;
    };
  }, [cameras, redAlertMode, armed, handleDetectionEvent]);

  const toggleMasterDetection = useCallback(() => {
    const next = !redAlertMode;
    setDetection({ redAlertMode: next });
    trackEvent(AnalyticsEvents.ARM_TOGGLE, { redAlertMode: next });
  }, [redAlertMode, setDetection]);

  const toggleArmed = useCallback(() => {
    const next = !armed;
    setDetection({ armed: next });
    trackEvent(AnalyticsEvents.ARM_TOGGLE, { armed: next });
    if (!next) {
      detectionManager.stopAll();
      setIsMonitoring(false);
    }
  }, [armed, setDetection]);

  return {
    isReady,
    isMonitoring,
    redAlertMode,
    armed,
    activeMonitoringCount: detectionManager.getMonitoredCameraCount(),
    toggleMasterDetection,
    toggleArmed,
  };
}
