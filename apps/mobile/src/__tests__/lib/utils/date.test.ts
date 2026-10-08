import {
  UNKNOWN_DATE_LABEL,
  formatDateLabel,
  formatDateTime,
  formatTimeOfDay,
  isValidDate,
  toIsoString,
  toValidDate,
} from '@/lib/utils/date';

/**
 * Every value here is something that has actually reached the UI in the field:
 * a corrupted AsyncStorage recording, a legacy `created_at` string, a realtime
 * payload with a missing field, a legacy epoch-seconds value.
 */
describe('date utils', () => {
  describe('toValidDate', () => {
    it('passes through a valid Date', () => {
      const d = new Date('2026-02-03T21:41:00.000Z');
      expect(toValidDate(d)).toBe(d);
    });

    it('parses ISO strings and epoch millis', () => {
      expect(toValidDate('2026-02-03T21:41:00.000Z')?.getTime()).toBe(
        new Date('2026-02-03T21:41:00.000Z').getTime(),
      );
      expect(toValidDate(1_700_000_000_000)?.getTime()).toBe(1_700_000_000_000);
    });

    it('rejects the values that used to crash the alert list', () => {
      // Each of these produced an Invalid Date, and the old
      // `date.toLocaleTimeString()` then threw RangeError inside renderItem.
      const bad = [
        undefined,
        null,
        '',
        '   ',
        'not-a-date',
        'Invalid Date',
        Number.NaN,
        Number.POSITIVE_INFINITY,
        {},
        [],
        true,
        new Date('nonsense'),
      ];
      for (const value of bad) {
        expect(toValidDate(value, null)).toBeNull();
        expect(isValidDate(value)).toBe(false);
      }
    });

    it('honours a fallback for unusable input', () => {
      const fallback = new Date('2020-01-01T00:00:00.000Z');
      expect(toValidDate('garbage', fallback)).toBe(fallback);
      expect(toValidDate(new Date('nope'), fallback)).toBe(fallback);
    });
  });

  describe('formatters never throw', () => {
    const hostile = [
      undefined,
      null,
      '',
      '   ',
      'not-a-date',
      Number.NaN,
      Number.POSITIVE_INFINITY,
      {},
      [],
      true,
      new Date('nonsense'),
    ];

    it('formatTimeOfDay degrades to a placeholder instead of RangeError', () => {
      for (const value of hostile) {
        expect(() => formatTimeOfDay(value)).not.toThrow();
        expect(formatTimeOfDay(value)).toBe(UNKNOWN_DATE_LABEL);
      }
    });

    it('formatDateLabel degrades safely', () => {
      for (const value of hostile) {
        expect(() => formatDateLabel(value)).not.toThrow();
        expect(formatDateLabel(value)).toBe(UNKNOWN_DATE_LABEL);
      }
    });

    it('formatDateTime degrades safely', () => {
      for (const value of hostile) {
        expect(() => formatDateTime(value)).not.toThrow();
      }
    });

    it('still formats real dates', () => {
      const iso = '2026-02-03T21:41:00.000Z';
      expect(formatTimeOfDay(iso)).not.toBe(UNKNOWN_DATE_LABEL);
      expect(formatDateLabel(iso)).not.toBe(UNKNOWN_DATE_LABEL);
      expect(formatDateTime(iso)).not.toBe(UNKNOWN_DATE_LABEL);
    });

    it('supports a custom fallback', () => {
      expect(formatTimeOfDay('garbage', 'unknown')).toBe('unknown');
    });
  });

  describe('toIsoString', () => {
    it('serialises valid dates', () => {
      expect(toIsoString('2026-02-03T21:41:00.000Z')).toBe(
        '2026-02-03T21:41:00.000Z',
      );
    });

    it('returns null rather than throwing RangeError', () => {
      // This guarded a real bug: an Invalid Date here aborted the whole
      // alert insert, so the alert was silently lost.
      expect(toIsoString(new Date('nonsense'))).toBeNull();
      expect(toIsoString(undefined)).toBeNull();
      expect(() => toIsoString('bad')).not.toThrow();
    });
  });
});
