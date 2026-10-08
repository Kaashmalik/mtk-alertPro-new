/**
 * Scene profile presets and shouldAlert filter tests
 */

import { mapCocoClassToDetectionType } from '@/features/detection/cocoClasses';
import {
  FREE_SCENE_PROFILES,
  applySceneProfile,
  getSceneProfile,
  isAdvancedSceneProfile,
  shouldAlert,
} from '@/features/detection/sceneProfiles';
import type { DetectionSettings } from '@/types';

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

  it('marks parking/warehouse/construction/school as advanced', () => {
    expect(isAdvancedSceneProfile('home')).toBe(false);
    expect(isAdvancedSceneProfile('farm')).toBe(false);
    expect(isAdvancedSceneProfile('shop')).toBe(false);
    expect(isAdvancedSceneProfile('parking')).toBe(true);
    expect(isAdvancedSceneProfile('warehouse')).toBe(true);
    expect(isAdvancedSceneProfile('construction')).toBe(true);
    expect(isAdvancedSceneProfile('school')).toBe(true);
    expect(FREE_SCENE_PROFILES).toContain('farm');
    expect(FREE_SCENE_PROFILES).not.toContain('school');
  });

  it('getSceneProfile falls back to home', () => {
    expect(getSceneProfile(undefined).id).toBe('home');
  });
});

describe('shouldAlert plan gating (hasFaceRecognition)', () => {
  const faceOn: DetectionSettings = {
    person: true,
    vehicle: true,
    face: true,
    animal: false,
    motion: false,
    sensitivity: 0.7,
    notificationsEnabled: true,
    alarmEnabled: true,
  };

  it('suppresses face alerts when the plan excludes face recognition', () => {
    // Regression guard: hasFaceRecognition was defined (false on free) but never
    // consulted, so a free account with face enabled received face alerts.
    expect(shouldAlert({ type: 'face' }, faceOn, { face: false })).toBe(false);
  });

  it('allows face alerts when the plan includes face recognition', () => {
    expect(shouldAlert({ type: 'face' }, faceOn, { face: true })).toBe(true);
  });

  it('leaves non-premium types untouched by the entitlement', () => {
    expect(shouldAlert({ type: 'person' }, faceOn, { face: false })).toBe(true);
    expect(shouldAlert({ type: 'vehicle' }, faceOn, { face: false })).toBe(
      true,
    );
  });

  it('defaults to allowing face when no entitlement is supplied', () => {
    // Back-compat for callers that don't model the plan.
    expect(shouldAlert({ type: 'face' }, faceOn)).toBe(true);
  });

  it('still respects the per-camera face toggle when entitled', () => {
    const faceOff = { ...faceOn, face: false };
    expect(shouldAlert({ type: 'face' }, faceOff, { face: true })).toBe(false);
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
