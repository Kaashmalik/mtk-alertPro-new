/**
 * Date formatting that cannot throw.
 *
 * `Date.prototype.toLocaleDateString` / `toLocaleTimeString` / `toISOString` all
 * throw `RangeError: Invalid time value` when handed an Invalid Date. A single
 * malformed row -- a corrupted AsyncStorage recording, a legacy
 * `created_at` format, a partially-migrated database row -- is therefore enough
 * to crash a whole screen from inside a FlatList `renderItem`, which the root
 * ErrorBoundary then turns into a blank screen.
 *
 * Every date that reaches the UI comes from storage, the database or the
 * realtime channel, so it is untrusted. These helpers coerce first and degrade
 * to a placeholder instead of throwing, so bad data costs one label rather than
 * a screen.
 *
 * @module lib/utils/date
 */

/** Shown in place of a timestamp we cannot parse. */
export const UNKNOWN_DATE_LABEL = '--';

/**
 * Coerce anything date-ish into a valid Date.
 *
 * @param value A Date, ISO/parseable string, epoch number, or junk.
 * @param fallback Used when `value` cannot be parsed. Pass `null` to return
 *   `null` and let the caller decide how to render the absence.
 */
export function toValidDate(
  value: unknown,
  fallback: Date | null = null,
): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? fallback : value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed;
  }

  return fallback;
}

/** True only for a real, parseable date. */
export function isValidDate(value: unknown): boolean {
  return toValidDate(value, null) !== null;
}

/**
 * Run a `Date` method that may throw, returning `fallback` instead.
 * Keeps the individual formatters below to one line each.
 */
function safeFormat(
  value: unknown,
  format: (date: Date) => string,
  fallback: string = UNKNOWN_DATE_LABEL,
): string {
  const date = toValidDate(value, null);
  if (!date) return fallback;
  try {
    const out = format(date);
    return out.length > 0 ? out : fallback;
  } catch {
    // Defensive: a locale/ICU difference can still throw inside the formatter.
    return fallback;
  }
}

/** e.g. `"09:41 PM"`. */
export function formatTimeOfDay(value: unknown, fallback?: string): string {
  return safeFormat(
    value,
    (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    fallback,
  );
}

/** e.g. `"2/3/2026"`. */
export function formatDateLabel(value: unknown, fallback?: string): string {
  return safeFormat(value, (d) => d.toLocaleDateString(), fallback);
}

/** e.g. `"2/3/2026, 09:41 PM"`. */
export function formatDateTime(value: unknown, fallback?: string): string {
  return safeFormat(value, (d) => d.toLocaleString(), fallback);
}

/** ISO string, or `null` when unparseable. For DB writes. */
export function toIsoString(value: unknown): string | null {
  const date = toValidDate(value, null);
  if (!date) return null;
  try {
    return date.toISOString();
  } catch {
    return null;
  }
}
