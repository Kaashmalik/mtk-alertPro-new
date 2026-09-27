/**
 * Detection zone CRUD.
 *
 * A zone is a polygon of normalised points (0..1) on the camera frame. The
 * detector only raises an alert when a detection's centre falls inside an
 * active zone and clears that zone's sensitivity threshold.
 *
 * @module lib/camera/zoneService
 */

import { supabase } from '@/lib/supabase/client';
import { logError } from '@/lib/utils/errorHandler';
import type { DetectionZone, ZonePoint } from '@/types';

type ZoneRow = {
  id: string;
  camera_id: string;
  name: string;
  polygon: unknown;
  is_active: boolean | null;
  sensitivity: number | null;
};

/** Smallest polygon that can enclose an area. */
export const MIN_POLYGON_POINTS = 3;

/**
 * Normalise whatever the DB returned into our polygon shape.
 * Guards against a hand-edited row containing a non-array or a flat list.
 */
function coercePolygon(value: unknown): ZonePoint[] {
  if (!Array.isArray(value)) return [];
  const points: ZonePoint[] = [];
  for (const entry of value) {
    if (Array.isArray(entry) && typeof entry[0] === 'number' && typeof entry[1] === 'number') {
      points.push({ x: clamp01(entry[0]), y: clamp01(entry[1]) });
      continue;
    }
    if (entry && typeof entry === 'object') {
      const { x, y } = entry as { x?: unknown; y?: unknown };
      if (typeof x === 'number' && typeof y === 'number') {
        points.push({ x: clamp01(x), y: clamp01(y) });
      }
    }
  }
  return points;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function toZone(row: ZoneRow): DetectionZone {
  return {
    id: row.id,
    name: row.name,
    polygon: coercePolygon(row.polygon),
    isActive: row.is_active !== false,
    sensitivity: typeof row.sensitivity === 'number' ? clamp01(row.sensitivity) : 0.6,
  };
}

/**
 * All zones for a camera, oldest first.
 */
export async function listZones(cameraId: string): Promise<DetectionZone[]> {
  const { data, error } = await supabase
    .from('detection_zones')
    .select('id, camera_id, name, polygon, is_active, sensitivity')
    .eq('camera_id', cameraId)
    .order('created_at', { ascending: true });

  if (error) {
    logError(error, 'zoneService.listZones');
    return [];
  }
  return ((data ?? []) as unknown as ZoneRow[]).map(toZone);
}

/**
 * Create a zone. Rejects polygons that cannot enclose an area, so a malformed
 * zone is never persisted (it would silently match nothing at detection time).
 */
export async function createZone(
  cameraId: string,
  name: string,
  polygon: ZonePoint[],
  sensitivity = 0.6
): Promise<DetectionZone | null> {
  if (polygon.length < MIN_POLYGON_POINTS) {
    console.warn('[Zones] Polygon needs at least 3 points');
    return null;
  }

  const trimmed = name.trim() || 'Zone';
  const { data, error } = await supabase
    .from('detection_zones')
    .insert({
      camera_id: cameraId,
      name: trimmed,
      polygon: polygon.map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) })) as never,
      is_active: true,
      sensitivity: clamp01(sensitivity),
    })
    .select('id, camera_id, name, polygon, is_active, sensitivity')
    .single();

  if (error) {
    logError(error, 'zoneService.createZone');
    return null;
  }
  return toZone(data as unknown as ZoneRow);
}

export async function updateZone(
  zoneId: string,
  changes: { name?: string; polygon?: ZonePoint[]; isActive?: boolean; sensitivity?: number }
): Promise<DetectionZone | null> {
  const update: Record<string, unknown> = {};
  if (changes.name !== undefined) update.name = changes.name.trim() || 'Zone';
  if (changes.isActive !== undefined) update.is_active = changes.isActive;
  if (changes.sensitivity !== undefined) update.sensitivity = clamp01(changes.sensitivity);
  if (changes.polygon !== undefined) {
    if (changes.polygon.length < MIN_POLYGON_POINTS) {
      console.warn('[Zones] Polygon needs at least 3 points');
      return null;
    }
    update.polygon = changes.polygon.map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) })) as never;
  }

  const { data, error } = await supabase
    .from('detection_zones')
    .update(update as never)
    .eq('id', zoneId)
    .select('id, camera_id, name, polygon, is_active, sensitivity')
    .single();

  if (error) {
    logError(error, 'zoneService.updateZone');
    return null;
  }
  return toZone(data as unknown as ZoneRow);
}

export async function deleteZone(zoneId: string): Promise<boolean> {
  const { error } = await supabase.from('detection_zones').delete().eq('id', zoneId);
  if (error) {
    logError(error, 'zoneService.deleteZone');
    return false;
  }
  return true;
}

/** Reorder points so the first is the topmost-leftmost, for stable rendering. */
export function normalizePolygon(points: ZonePoint[]): ZonePoint[] {
  if (points.length === 0) return [];
  const anchor = points.reduce((best, p) =>
    p.y < best.y || (p.y === best.y && p.x < best.x) ? p : best
  );
  const rest = points.filter((p) => p !== anchor);
  return [anchor, ...rest];
}
