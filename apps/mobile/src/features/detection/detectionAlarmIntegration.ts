/**
 * Detection-Alarm Integration
 * Connects detection events to alarm system with red alert mode support
 */

import { alarmService } from '@/lib/audio/alarmService';
import { useSettingsStore } from '@/stores/settingsStore';
import { hapticNotification } from '@/lib/haptics';
import type { DetectionResult, AlarmSoundType } from '@/types';

export interface DetectionAlarmConfig {
    enabled: boolean;
    redAlertMode: boolean;
    alarmSound: AlarmSoundType;
    alarmVolume: number;
    repeatAlarm: boolean;
    repeatCount: number;
}

/**
 * Handle detection event and trigger alarm if needed
 */
export async function handleDetectionAlarm(
    detections: DetectionResult[],
    cameraId: string,
    cameraSettings?: {
        alarmEnabled: boolean;
        notificationsEnabled: boolean;
    }
): Promise<void> {
    if (detections.length === 0) return;

    // Get current settings
    const settings = useSettingsStore.getState();
    const { notifications, detection } = settings;

    // Alerts fully disabled ??? nothing fires.
    if (!notifications.enabled) {
        return;
    }

    // Check camera-specific alarm settings if provided
    if (cameraSettings && !cameraSettings.alarmEnabled) {
        console.log('[DetectionAlarm] Camera alarm disabled, skipping');
        return;
    }

    // Sound is opt-in (silent by default). When it's off we still alert through
    // vibration + the push-notification pipeline ??? we only skip the audible
    // alarm. This keeps "silent mode" genuinely useful instead of going fully
    // dark on detections.
    const soundOn = notifications.sound === true;
    const vibrate = notifications.vibration === true;

    // Determine if this is a high-priority detection
    const hasPersonDetection = detections.some(d => d.type === 'person' && d.confidence >= 0.60);
    const hasVehicleDetection = detections.some(d => d.type === 'vehicle' && d.confidence >= 0.65);
    const highPriority = hasPersonDetection || hasVehicleDetection;

    // Red alert mode fires on any detection; otherwise only high-confidence ones.
    const immediate = detection.redAlertMode || highPriority;

    if (immediate) {
        if (soundOn) {
            await triggerAlarm({
                enabled: true,
                redAlertMode: detection.redAlertMode,
                alarmSound: notifications.alarmSound,
                alarmVolume: notifications.alarmVolume,
                repeatAlarm: notifications.repeatAlarm,
                repeatCount: notifications.repeatCount,
            }, vibrate);
        } else if (vibrate) {
            // Silent mode ??? strong haptic only, no audible alarm.
            hapticNotification();
        }
        return;
    }

    // Low-priority detection: just haptic feedback (when enabled).
    if (vibrate) {
        hapticNotification();
    }
}

/**
 * Trigger alarm with configuration
 */
async function triggerAlarm(config: DetectionAlarmConfig, vibrate: boolean): Promise<void> {
    try {
        // Play haptic feedback
        if (vibrate) {
            hapticNotification();
        }

        // Play alarm sound
        await alarmService.playAlarm(
            config.alarmSound,
            {
                volume: config.alarmVolume,
                repeat: config.repeatAlarm,
                repeatCount: config.repeatCount,
                // Respect the user's vibration preference. The service used to
                // vibrate unconditionally, ignoring the settings toggle.
                vibrate,
            }
        );

        console.log('[DetectionAlarm] Alarm triggered', {
            sound: config.alarmSound,
            redAlert: config.redAlertMode,
        });
    } catch (error) {
        console.error('[DetectionAlarm] Failed to trigger alarm:', error);
    }
}

/**
 * Stop any currently playing alarm
 */
export async function stopDetectionAlarm(): Promise<void> {
    await alarmService.stopAlarm();
}
