/**
 * Detection zone filtering using polygon zones from Camera.detectionSettings
 */

import type { DetectionZone } from '@/types';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Model score for this detection, 0..1. Required: per-zone sensitivity is
   * only meaningful against a real score, and defaulting it would make every
   * zone threshold pass unconditionally.
   */
  confidence: number;
}

/** Applied to zones that predate the per-zone sensitivity column. */
const DEFAULT_SENSITIVITY = 0.6;

function pointInPolygon(
  px: number,
  py: number,
  polygon: { x: number; y: number }[]
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Pass if no active zones, or the detection center is inside an active zone
 * whose confidence bar the detection also clears.
 *
 * A zone's `sensitivity` lets a noisy area (a road) demand high confidence
 * while a driveway stays sensitive. Default 0.6 for zones written before the
 * column existed.
 */
export function isDetectionInZones(
  box: BoundingBox | undefined,
  zones: DetectionZone[] | null | undefined
): boolean {
  if (!zones || zones.length === 0) return true;
  if (!box) return true;

  const active = zones.filter((z) => z.isActive && z.polygon?.length >= 3);
  if (active.length === 0) return true;

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  return active.some((z) => {
    if (!pointInPolygon(cx, cy, z.polygon)) return false;
    const threshold = typeof z.sensitivity === 'number' ? z.sensitivity : DEFAULT_SENSITIVITY;
    return box.confidence >= threshold;
  });
}
