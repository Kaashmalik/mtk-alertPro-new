/**
 * Detection Coordinator Hook
 * Synchronizes camera settings, master Red Alert toggle, and detectionManager
 * 
 * @module hooks/useDetectionCoordinator
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useCameraStore, useSettingsStore, useAlertStore } from '@/stores';
import { detectionManager } from '@/features/detection/detectionManager';
import { sendLocalNotification } from '@/lib/notifications/service';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import type { DetectionEvent } from '@/features/detection/detectionManager';

export function useDetectionCoordinator() {
  const cameras = useCameraStore((state) => state.cameras);
  const redAlertMode = useSettingsStore((state) => state.detection.redAlertMode);
  const setDetection = useSettingsStore((state) => state.setDetection);
  const addAlert = useAlertStore((state) => state.addAlert);

  const [isReady, setIsReady] = useState(false);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Initialize detection sound
  useEffect(() => {
    let mounted = true;

    async function setupAudio() {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          shouldDuckAndroid: true,
        });
      } catch (err) {
        console.warn('[DetectionCoordinator] Audio setup warning:', err);
      }
    }

    setupAudio();

    return () => {
      mounted = false;
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
      }
    };
  }, []);

  // Handle detection events from detectionManager
  const handleDetectionEvent = useCallback(
    async (event: DetectionEvent) => {
      console.log(`[DetectionCoordinator] Received detection: ${event.type} on ${event.cameraName}`);

      // 1. Add alert to Alert Store
      try {
        const alertType = event.type === 'unknown' ? 'motion' : event.type;
        await addAlert({
          cameraId: event.cameraId,
          cameraName: event.cameraName,
          type: alertType,
          confidence: event.confidence,
          timestamp: event.timestamp || new Date(),
          isRead: false,
          snapshotUrl: event.snapshotPath,
        });
      } catch (err) {
        console.warn('[DetectionCoordinator] Failed to add alert to store:', err);
      }

      // 2. Play Haptics
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } catch {}

      // 3. Send Push/Local Notification
      try {
        await sendLocalNotification({
          title: `⚠️ ${event.type.toUpperCase()} DETECTED`,
          body: `${event.cameraName} detected a ${event.type} (${Math.round(event.confidence * 100)}% confidence)`,
          data: { cameraId: event.cameraId, type: event.type },
        });
      } catch (err) {
        console.warn('[DetectionCoordinator] Failed to send notification:', err);
      }

      // 4. Play alert sound if Red Alert is enabled
      if (redAlertMode) {
        try {
          // Play notification beep or alarm
          const { sound } = await Audio.Sound.createAsync(
            { uri: 'https://actions.google.com/sounds/v1/alarms/beep_short.ogg' },
            { shouldPlay: true, volume: 1.0 }
          );
          soundRef.current = sound;
        } catch (soundErr) {
          console.warn('[DetectionCoordinator] Sound playback notice:', soundErr);
        }
      }
    },
    [addAlert, redAlertMode]
  );

  // Synchronize monitoring loop with cameras and Red Alert switch
  useEffect(() => {
    let isCancelled = false;

    async function syncDetection() {
      // Subscribe to detection events if not already subscribed
      if (!unsubscribeRef.current) {
        unsubscribeRef.current = detectionManager.onDetection(handleDetectionEvent);
      }

      // Active cameras with detection enabled (or all active if Red Alert is ON)
      const targetCameras = cameras.filter((cam) => {
        if (!cam.isActive) return false;
        if (redAlertMode) return true;
        const ds = cam.detectionSettings;
        return Boolean(ds?.person || ds?.vehicle || ds?.face);
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

        // Start monitoring each target camera
        for (const camera of targetCameras) {
          // Ensure at least person detection is active in Red Alert mode
          const effectiveCamera = {
            ...camera,
            detectionSettings: {
              ...camera.detectionSettings,
              person: redAlertMode ? true : camera.detectionSettings.person,
              vehicle: redAlertMode ? true : camera.detectionSettings.vehicle,
              sensitivity: redAlertMode ? 0.5 : (camera.detectionSettings.sensitivity || 0.65),
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
  }, [cameras, redAlertMode, handleDetectionEvent]);

  // Master toggle function
  const toggleMasterDetection = useCallback(() => {
    setDetection({ redAlertMode: !redAlertMode });
  }, [redAlertMode, setDetection]);

  return {
    isReady,
    isMonitoring,
    redAlertMode,
    activeMonitoringCount: detectionManager.getMonitoredCameraCount(),
    toggleMasterDetection,
  };
}
