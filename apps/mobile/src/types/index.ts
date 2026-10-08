export interface User {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  subscriptionTier: 'free' | 'pro' | 'business';
  subscriptionExpiresAt: Date | null;
  fcmToken: string | null;
}

export interface Camera {
  id: string;
  userId: string;
  name: string;
  rtspUrl: string;
  username?: string;
  password?: string;
  isActive: boolean;
  thumbnailUrl?: string;
  detectionSettings: DetectionSettings;
  createdAt: Date;
  updatedAt: Date;
}

export type SceneProfileId =
  | 'home'
  | 'farm'
  | 'shop'
  | 'parking'
  | 'warehouse'
  | 'construction'
  | 'school'
  | 'custom';

export type DetectionType =
  | 'person'
  | 'vehicle'
  | 'face'
  | 'animal'
  | 'motion'
  | 'unknown';

export interface DetectionSettings {
  /** Scene preset controlling alert rules (farm ignores animals, shop focuses on people, etc.) */
  sceneProfile?: SceneProfileId;
  person: boolean;
  vehicle: boolean;
  face?: boolean;
  /** When true, animal detections can alert; farm presets set this false */
  animal?: boolean;
  /** When false, motion-fallback alerts are suppressed for this camera */
  motion?: boolean;
  sensitivity: number;
  cooldownSeconds?: number;
  notificationsEnabled: boolean;
  alarmEnabled: boolean;
  zones?: DetectionZone[];
}

export interface ZonePoint {
  x: number;
  y: number;
}

export interface DetectionZone {
  id: string;
  name: string;
  polygon: ZonePoint[];
  isActive: boolean;
  /** Minimum confidence required inside this zone (0-1). */
  sensitivity?: number;
}

export interface Alert {
  id: string;
  /** Null for SOS alerts, which are raised by the user and not by a camera. */
  cameraId: string | null;
  userId: string;
  type: 'person' | 'vehicle' | 'face' | 'motion' | 'animal' | 'emergency';
  confidence: number;
  thumbnailUrl?: string;
  snapshotUrl?: string;
  videoClipUrl?: string;
  metadata: Record<string, unknown>;
  isRead: boolean;
  /** Set while an SOS alert is active; cleared once resolved. */
  emergencyReason?: string;
  resolvedAt?: Date;
  createdAt: Date;
}

// Alarm sound types - each has a unique vibration pattern
export type AlarmSoundType =
  | 'urgent'
  | 'siren'
  | 'alert'
  | 'chime'
  | 'beep'
  | 'heavy'
  | 'sos'
  | 'custom';

/**
 * Canonical detection defaults.
 *
 * `cameras.detection_settings` is nullable JSONB, so every read has to tolerate
 * a null or partial object. Single source of truth for those defaults so the
 * store and the detection manager cannot drift apart.
 */
export const DEFAULT_DETECTION_SETTINGS: Required<
  Pick<
    DetectionSettings,
    | 'person'
    | 'vehicle'
    | 'notificationsEnabled'
    | 'alarmEnabled'
    | 'sensitivity'
  >
> &
  DetectionSettings = {
  sceneProfile: 'home',
  person: true,
  vehicle: true,
  face: false,
  animal: false,
  motion: false,
  sensitivity: 0.7,
  cooldownSeconds: 30,
  notificationsEnabled: true,
  alarmEnabled: true,
};

export interface AppSettings {
  notifications: {
    enabled: boolean;
    push: boolean;
    sound: boolean;
    vibration: boolean;
    // Sound settings
    alarmSound: AlarmSoundType;
    alarmVolume: number; // 0.0 to 1.0
    repeatAlarm: boolean;
    repeatCount: number; // -1 for infinite
  };
  detection: {
    redAlertMode: boolean;
    cooldownSeconds: number;
    /** Master arm — when false, detection/alarms are gated off */
    armed: boolean;
  };
  display: {
    theme: 'light' | 'dark' | 'system';
    streamQuality: '720p' | '1080p';
  };
  security: {
    biometricEnabled: boolean;
    autoLock: boolean;
    autoLockTimeout: number; // in seconds
  };
}

export interface DetectionResult {
  type: 'person' | 'vehicle' | 'face' | 'animal' | 'unknown';
  confidence: number;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}
