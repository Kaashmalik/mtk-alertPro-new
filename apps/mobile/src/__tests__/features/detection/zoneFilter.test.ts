/**
 * Unit tests for motion detector scoring helpers and zone filter
 */

import {
  markLocalAlert,
  wasLocalAlertRecent,
} from '@/features/detection/alertDedup';
import { isDetectionInZones } from '@/features/detection/zoneFilter';

describe('zoneFilter', () => {
  it('passes when no zones configured', () => {
    expect(
      isDetectionInZones(
        { x: 0.1, y: 0.1, width: 0.2, height: 0.2, confidence: 0.9 },
        [],
      ),
    ).toBe(true);
  });

  it('detects point inside polygon', () => {
    const zones = [
      {
        id: 'z1',
        name: 'door',
        isActive: true,
        polygon: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
      },
    ];
    expect(
      isDetectionInZones(
        { x: 0.4, y: 0.4, width: 0.1, height: 0.1, confidence: 0.9 },
        zones,
      ),
    ).toBe(true);
  });

  it('rejects outside polygon', () => {
    const zones = [
      {
        id: 'z1',
        name: 'corner',
        isActive: true,
        polygon: [
          { x: 0, y: 0 },
          { x: 0.2, y: 0 },
          { x: 0.2, y: 0.2 },
          { x: 0, y: 0.2 },
        ],
      },
    ];
    expect(
      isDetectionInZones(
        { x: 0.8, y: 0.8, width: 0.05, height: 0.05, confidence: 0.9 },
        zones,
      ),
    ).toBe(false);
  });

  // Regression guard: a default of 1 for a missing confidence made
  // `confidence >= threshold` unconditionally true, so per-zone sensitivity
  // silently never rejected anything.
  describe('per-zone sensitivity', () => {
    const fullFrame = [
      {
        id: 'z1',
        name: 'driveway',
        isActive: true,
        polygon: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
      },
    ];
    const box = { x: 0.4, y: 0.4, width: 0.1, height: 0.1 };

    it('rejects a low-confidence detection inside a high-sensitivity zone', () => {
      const zones = [{ ...fullFrame[0], sensitivity: 0.9 }];
      expect(isDetectionInZones({ ...box, confidence: 0.4 }, zones)).toBe(
        false,
      );
    });

    it('accepts a high-confidence detection inside a high-sensitivity zone', () => {
      const zones = [{ ...fullFrame[0], sensitivity: 0.9 }];
      expect(isDetectionInZones({ ...box, confidence: 0.95 }, zones)).toBe(
        true,
      );
    });

    it('accepts a low-confidence detection inside a low-sensitivity zone', () => {
      const zones = [{ ...fullFrame[0], sensitivity: 0.2 }];
      expect(isDetectionInZones({ ...box, confidence: 0.4 }, zones)).toBe(true);
    });

    it('applies the legacy default sensitivity to zones written before the column', () => {
      // DEFAULT_SENSITIVITY is 0.6, so 0.5 is rejected and 0.8 passes.
      expect(isDetectionInZones({ ...box, confidence: 0.5 }, fullFrame)).toBe(
        false,
      );
      expect(isDetectionInZones({ ...box, confidence: 0.8 }, fullFrame)).toBe(
        true,
      );
    });

    it('ignores sensitivity for inactive zones', () => {
      const zones = [{ ...fullFrame[0], isActive: false, sensitivity: 0.99 }];
      expect(isDetectionInZones({ ...box, confidence: 0.1 }, zones)).toBe(true);
    });
  });
});

describe('alertDedup', () => {
  it('marks and detects recent local alerts', () => {
    markLocalAlert('cam1', 'person');
    expect(wasLocalAlertRecent('cam1', 'person')).toBe(true);
    expect(wasLocalAlertRecent('cam1', 'vehicle')).toBe(false);
  });

  // SOS alerts have no camera, so dedup keys off a sentinel scope instead.
  it('dedupes camera-less alerts under their own scope', () => {
    markLocalAlert(null, 'emergency');
    expect(wasLocalAlertRecent(null, 'emergency')).toBe(true);
    expect(wasLocalAlertRecent(null, 'person')).toBe(false);
    expect(wasLocalAlertRecent('cam1', 'emergency')).toBe(false);
  });
});
