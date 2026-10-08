/**
 * Boundary validation for alert rows.
 *
 * `alerts` rows arrive from PostgREST and from the realtime channel, and the
 * schema has changed underneath us more than once: `camera_id` became
 * nullable, `emergency` was added to the type constraint, and `resolved_at` /
 * `emergency_reason` were introduced. A row that predates a change, or that a
 * partially-applied migration left in an odd state, must not be able to
 * white-screen the app -- the previous behaviour let `type.charAt(...)` throw
 * inside the list item and take down the whole tree via the root ErrorBoundary.
 *
 * So every row is coerced into a shape the UI can render unconditionally.
 *
 * @module features/detection/alertSanitizer
 */

import type { Alert } from '@/types';

/** Types the UI knows how to render. */
const KNOWN_TYPES: readonly Alert['type'][] = [
  'person',
  'vehicle',
  'face',
  'motion',
  'animal',
  'emergency',
];

/** Shown when the stored type is not one we recognise. */
const FALLBACK_TYPE: Alert['type'] = 'motion';

function coerceType(value: unknown): Alert['type'] {
  return typeof value === 'string' &&
    (KNOWN_TYPES as readonly string[]).includes(value)
    ? (value as Alert['type'])
    : FALLBACK_TYPE;
}

/** Model scores are 0..1; anything else would render as "NaN%" or "1200%". */
function coerceConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function coerceDate(value: unknown): Date {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? new Date() : value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** `metadata` is free-form JSON and may be a scalar or absent. */
function coerceMetadata(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/**
 * Convert a raw database row into a render-safe Alert.
 * @returns null only when the row has no usable identity.
 */
export function toAlert(
  row: Record<string, unknown> | null | undefined,
): Alert | null {
  if (!row) return null;

  const id = typeof row.id === 'string' ? row.id : '';
  if (!id) return null;

  const rawType = coerceType(row.type);

  return {
    id,
    // Nullable since the emergency migration: SOS alerts have no camera.
    cameraId:
      typeof row.camera_id === 'string' && row.camera_id ? row.camera_id : null,
    userId: typeof row.user_id === 'string' ? row.user_id : '',
    type: rawType,
    confidence: coerceConfidence(row.confidence),
    snapshotUrl: optionalString(row.snapshot_url),
    videoClipUrl: optionalString(row.video_clip_url),
    metadata: coerceMetadata(row.metadata),
    isRead: row.is_read === true,
    emergencyReason: optionalString(row.emergency_reason),
    createdAt: coerceDate(row.created_at),
  };
}

/** Map a result set, dropping unusable rows rather than failing the page. */
export function toAlerts(rows: unknown): Alert[] {
  if (!Array.isArray(rows)) return [];
  const result: Alert[] = [];
  for (const row of rows) {
    const alert = toAlert(row as Record<string, unknown>);
    if (alert) result.push(alert);
  }
  return result;
}
