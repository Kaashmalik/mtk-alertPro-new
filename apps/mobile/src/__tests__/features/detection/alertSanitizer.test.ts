/**
 * The alerts screen used to white-screen whenever the `alerts` table handed back
 * a row the UI could not render (a null type made `type.charAt(...)` throw
 * inside the list item and take down the whole tree via the root ErrorBoundary).
 * These tests pin the boundary coercion that prevents a regression.
 */

import { toAlert, toAlerts } from '@/features/detection/alertSanitizer';

const baseRow = {
  id: 'a1',
  camera_id: 'cam1',
  user_id: 'u1',
  type: 'person',
  confidence: 0.82,
  is_read: false,
  created_at: '2026-09-27T10:00:00.000Z',
  metadata: { source: 'detection' },
};

describe('alertSanitizer', () => {
  it('maps a well-formed row', () => {
    const alert = toAlert(baseRow);
    expect(alert).not.toBeNull();
    expect(alert).toMatchObject({
      id: 'a1',
      cameraId: 'cam1',
      type: 'person',
      confidence: 0.82,
      isRead: false,
    });
    expect(alert?.createdAt).toBeInstanceOf(Date);
  });

  it('accepts a null camera_id (SOS alerts have no camera)', () => {
    const alert = toAlert({ ...baseRow, camera_id: null, type: 'emergency' });
    expect(alert?.cameraId).toBeNull();
    expect(alert?.type).toBe('emergency');
  });

  it('falls back instead of throwing on an unrecognised type', () => {
    // This is the case that crashed the alerts screen.
    const alert = toAlert({ ...baseRow, type: null });
    expect(alert?.type).toBe('motion');
  });

  it('coerces a type the app does not know about', () => {
    expect(toAlert({ ...baseRow, type: 'drone' })?.type).toBe('motion');
  });

  it('clamps confidence into 0..1 and survives NaN', () => {
    expect(toAlert({ ...baseRow, confidence: 5 })?.confidence).toBe(1);
    expect(toAlert({ ...baseRow, confidence: -2 })?.confidence).toBe(0);
    expect(toAlert({ ...baseRow, confidence: Number.NaN })?.confidence).toBe(0);
    expect(toAlert({ ...baseRow, confidence: null })?.confidence).toBe(0);
  });

  it('never yields an invalid Date', () => {
    expect(toAlert({ ...baseRow, created_at: null })?.createdAt).toBeInstanceOf(
      Date,
    );
    expect(
      toAlert({ ...baseRow, created_at: 'not-a-date' })?.createdAt,
    ).toBeInstanceOf(Date);
    expect(
      toAlert({ ...baseRow, created_at: 'not-a-date' })?.createdAt.getTime(),
    ).not.toBeNaN();
  });

  it('normalises non-object metadata to an object', () => {
    expect(toAlert({ ...baseRow, metadata: null })?.metadata).toEqual({});
    expect(toAlert({ ...baseRow, metadata: 'oops' })?.metadata).toEqual({});
    expect(toAlert({ ...baseRow, metadata: [1, 2] })?.metadata).toEqual({});
  });

  it('drops rows with no usable id', () => {
    expect(toAlert({ ...baseRow, id: null })).toBeNull();
    expect(toAlert({ ...baseRow, id: '' })).toBeNull();
    expect(toAlert(null)).toBeNull();
  });

  it('toAlerts skips unusable rows but keeps the good ones', () => {
    const alerts = toAlerts([
      baseRow,
      { ...baseRow, id: null },
      { ...baseRow, id: 'a2' },
    ]);
    expect(alerts.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('toAlerts tolerates a non-array payload', () => {
    expect(toAlerts(null)).toEqual([]);
    expect(toAlerts({})).toEqual([]);
  });
});
