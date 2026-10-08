/**
 * Scene Detection Profiles
 * Presets that control which detection types trigger alerts per camera use-case.
 */

import type { DetectionSettings, DetectionResult, SceneProfileId } from '@/types';

export interface SceneProfileDefinition {
  id: SceneProfileId;
  label: string;
  description: string;
  /** Free tier can use without upgrade */
  freeTier: boolean;
  /** Patch applied when selecting this profile */
  settings: Pick<
    DetectionSettings,
    | 'person'
    | 'vehicle'
    | 'face'
    | 'animal'
    | 'motion'
    | 'sensitivity'
    | 'cooldownSeconds'
  >;
}

export const SCENE_PROFILES: SceneProfileDefinition[] = [
  {
    id: 'home',
    label: 'Home',
    description: 'Alerts for people and vehicles. Animals ignored.',
    freeTier: true,
    settings: {
      person: true,
      vehicle: true,
      face: false,
      animal: false,
      motion: false,
      sensitivity: 0.65,
      cooldownSeconds: 30,
    },
  },
  {
    id: 'farm',
    label: 'Farm',
    description: 'Intruders (people/vehicles) only. Livestock and pets never alert.',
    freeTier: true,
    settings: {
      person: true,
      vehicle: true,
      face: false,
      animal: false,
      motion: false,
      sensitivity: 0.7,
      cooldownSeconds: 45,
    },
  },
  {
    id: 'shop',
    label: 'Shop',
    description: 'People-focused for theft risk. Higher sensitivity, shorter cooldown.',
    freeTier: true,
    settings: {
      person: true,
      vehicle: false,
      face: true,
      animal: false,
      motion: false,
      sensitivity: 0.55,
      cooldownSeconds: 15,
    },
  },
  {
    id: 'parking',
    label: 'Parking',
    description: 'People and vehicles in lots. Animals ignored.',
    freeTier: true,
    settings: {
      person: true,
      vehicle: true,
      face: false,
      animal: false,
      motion: false,
      sensitivity: 0.6,
      cooldownSeconds: 25,
    },
  },
  {
    id: 'warehouse',
    label: 'Warehouse',
    description: 'Staff and vehicle activity. Animals ignored.',
    freeTier: true,
    settings: {
      person: true,
      vehicle: true,
      face: false,
      animal: false,
      motion: false,
      sensitivity: 0.65,
      cooldownSeconds: 30,
    },
  },
  {
    id: 'construction',
    label: 'Construction',
    description: 'Workers and machinery. Animals ignored.',
    freeTier: true,
    settings: {
      person: true,
      vehicle: true,
      face: false,
      animal: false,
      motion: false,
      sensitivity: 0.7,
      cooldownSeconds: 40,
    },
  },
  {
    id: 'school',
    label: 'School',
    description: 'People-focused campus safety. Vehicles off by default.',
    freeTier: true,
    settings: {
      person: true,
      vehicle: false,
      face: false,
      animal: false,
      motion: false,
      sensitivity: 0.6,
      cooldownSeconds: 20,
    },
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Manual toggles — you control every detection type.',
    freeTier: true,
    settings: {
      person: true,
      vehicle: true,
      face: false,
      animal: false,
      motion: true,
      sensitivity: 0.65,
      cooldownSeconds: 30,
    },
  },
];

export function getSceneProfile(id: SceneProfileId | undefined): SceneProfileDefinition {
  const found = SCENE_PROFILES.find((p) => p.id === (id || 'home'));
  return found || SCENE_PROFILES[0];
}

/**
 * Apply a scene preset onto existing settings (preserves notifications/alarm/zones).
 */
export function applySceneProfile(
  profileId: SceneProfileId,
  current?: Partial<DetectionSettings>
): DetectionSettings {
  const profile = getSceneProfile(profileId);
  return {
    notificationsEnabled: current?.notificationsEnabled ?? true,
    alarmEnabled: current?.alarmEnabled ?? true,
    zones: current?.zones,
    ...profile.settings,
    sceneProfile: profileId,
  };
}

export type AlertableType = 'person' | 'vehicle' | 'face' | 'animal' | 'motion' | 'unknown';

/**
 * Whether this detection should raise an alert for the camera settings.
 * Animals are suppressed unless settings.animal === true (farm never enables this).
 */
export function shouldAlert(
  detection: Pick<DetectionResult, 'type'> | { type: AlertableType },
  settings: DetectionSettings
): boolean {
  const type = detection.type === 'unknown' ? 'motion' : detection.type;

  switch (type) {
    case 'person':
      return settings.person === true;
    case 'vehicle':
      return settings.vehicle === true;
    case 'face':
      return settings.face === true;
    case 'animal':
      // Explicit opt-in only — farm/shop/home presets keep this false
      return settings.animal === true;
    case 'motion':
      return settings.motion === true;
    default:
      return false;
  }
}

/**
 * Every scene mode ships on every tier.
 * Detection presets are a core safety feature, not a paywall lever — so Home,
 * School, Farm, Shop, Parking, Warehouse, Construction and Custom are all
 * available to every user. (Pro differentiates on capacity/cloud, not safety.)
 */
export const FREE_SCENE_PROFILES: SceneProfileId[] = SCENE_PROFILES.filter(
  (p) => p.freeTier
).map((p) => p.id);

/**
 * Whether a scene profile is gated behind Pro.
 * Always `false`: scene modes are universal. Kept as a stable export so callers
 * (pickers, screens) don't need to change if gating is ever reintroduced.
 */
export function isAdvancedSceneProfile(_id: SceneProfileId): boolean {
  return false;
}
