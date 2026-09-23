/**
 * Unit tests for motion detector scoring helpers and zone filter
 */

import { isDetectionInZones } from '@/features/detection/zoneFilter';
import { wasLocalAlertRecent, markLocalAlert } from '@/features/detection/alertDedup';

describe('zoneFilter', () => {
  it('passes when no zones configured', () => {
    expect(
      isDetectionInZones({ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, [])
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
      isDetectionInZones({ x: 0.4, y: 0.4, width: 0.1, height: 0.1 }, zones)
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
      isDetectionInZones({ x: 0.8, y: 0.8, width: 0.05, height: 0.05 }, zones)
    ).toBe(false);
  });
});

describe('alertDedup', () => {
  it('marks and detects recent local alerts', () => {
    markLocalAlert('cam1', 'person');
    expect(wasLocalAlertRecent('cam1', 'person')).toBe(true);
    expect(wasLocalAlertRecent('cam1', 'vehicle')).toBe(false);
  });
});
