/**
 * Scene profile presets and shouldAlert filter tests
 */

import {
  applySceneProfile,
  shouldAlert,
  getSceneProfile,
  isAdvancedSceneProfile,
  FREE_SCENE_PROFILES,
} from '@/features/detection/sceneProfiles';
import { mapCocoClassToDetectionType } from '@/features/detection/cocoClasses';

describe('sceneProfiles', () => {
  it('farm suppresses animals and enables person/vehicle', () => {
    const settings = applySceneProfile('farm');
    expect(settings.sceneProfile).toBe('farm');
    expect(settings.person).toBe(true);
    expect(settings.vehicle).toBe(true);
    expect(settings.animal).toBe(false);
    expect(settings.face).toBe(false);
    expect(settings.motion).toBe(false);
    expect(settings.sensitivity).toBe(0.7);
    expect(settings.cooldownSeconds).toBe(45);

    expect(shouldAlert({ type: 'person' }, settings)).toBe(true);
    expect(shouldAlert({ type: 'vehicle' }, settings)).toBe(true);
    expect(shouldAlert({ type: 'animal' }, settings)).toBe(false);
    expect(shouldAlert({ type: 'motion' }, settings)).toBe(false);
  });

  it('shop focuses on person/face for theft risk', () => {
    const settings = applySceneProfile('shop');
    expect(settings.person).toBe(true);
    expect(settings.face).toBe(true);
    expect(settings.vehicle).toBe(false);
    expect(settings.animal).toBe(false);
    expect(settings.sensitivity).toBe(0.55);
    expect(settings.cooldownSeconds).toBe(15);

    expect(shouldAlert({ type: 'person' }, settings)).toBe(true);
    expect(shouldAlert({ type: 'face' }, settings)).toBe(true);
    expect(shouldAlert({ type: 'vehicle' }, settings)).toBe(false);
    expect(shouldAlert({ type: 'animal' }, settings)).toBe(false);
  });

  it('custom preserves notification flags from current settings', () => {
    const settings = applySceneProfile('custom', {
      notificationsEnabled: false,
      alarmEnabled: false,
    });
    expect(settings.notificationsEnabled).toBe(false);
    expect(settings.alarmEnabled).toBe(false);
    expect(settings.sceneProfile).toBe('custom');
  });

  it('treats every scene mode as universal (no Pro gating)', () => {
    // Scene detection presets are a core safety feature, not a paywall lever —
    // every mode is available on every tier.
    const allModes = [
      'home',
      'farm',
      'shop',
      'parking',
      'warehouse',
      'construction',
      'school',
      'custom',
    ] as const;
    for (const mode of allModes) {
      expect(isAdvancedSceneProfile(mode)).toBe(false);
      expect(FREE_SCENE_PROFILES).toContain(mode);
    }
  });

  it('getSceneProfile falls back to home', () => {
    expect(getSceneProfile(undefined).id).toBe('home');
  });
});

describe('COCO animal class map', () => {
  it('maps livestock and pets to animal', () => {
    expect(mapCocoClassToDetectionType(16)).toBe('animal'); // dog
    expect(mapCocoClassToDetectionType(19)).toBe('animal'); // cow
    expect(mapCocoClassToDetectionType(14)).toBe('animal'); // bird
    expect(mapCocoClassToDetectionType(0)).toBe('person');
    expect(mapCocoClassToDetectionType(2)).toBe('vehicle');
    expect(mapCocoClassToDetectionType(99)).toBeNull();
  });
});
