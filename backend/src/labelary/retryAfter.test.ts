import { classify429, parseRetryAfter } from './retryAfter';

/**
 * What an HTTP 429 from Labelary means (Etapa 4, audit): decided only by Retry-After, in seconds or as an HTTP date; the
 * words of the body are never read, so no message can shut the service off. A wait of a minute or more is the daily
 * quota (and is believed for at most 24 hours); less is the pace; nothing usable is the usual short pause.
 */

const NOW = Date.parse('2026-11-18T12:00:00Z');
const O = { dailyAtMs: 60_000, maxBlockMs: 24 * 3_600_000, defaultPauseMs: 5_000 };
const classify = (header: string | null | undefined) => classify429(header, NOW, O);
const date = (ms: number) => new Date(NOW + ms).toUTCString();

describe('Retry-After in seconds', () => {
  test.each([
    ['1', 'rate-limited', 1_000],
    ['59', 'rate-limited', 59_000],
    ['60', 'quota-external', 60_000],          // a minute is the first wait that is the daily quota
    ['120', 'quota-external', 120_000],
    ['7200', 'quota-external', 7_200_000],
    ['86400', 'quota-external', 86_400_000],
    ['999999', 'quota-external', 86_400_000],  // never more than 24 hours
    ['  30  ', 'rate-limited', 30_000],
  ])('%s -> %s for %s ms', (header, kind, ms) => {
    expect(classify(header)).toEqual({ kind, retryAfterMs: ms });
  });

  test('no header, an empty one, zero, negative, a decimal or not a number: the usual short pause, and never a block', () => {
    for (const header of [null, undefined, '', '   ', '0', '-5', '-1', '1.5', 'abc', '5s', '1e3', '0x10', '99999999999999999999']) {
      expect(classify(header)).toEqual({ kind: 'rate-limited', retryAfterMs: 5_000 });
    }
  });
});

describe('Retry-After as an HTTP date', () => {
  test('a date hours away is the daily quota, for the time left', () => {
    expect(classify(date(3 * 3_600_000))).toEqual({ kind: 'quota-external', retryAfterMs: 3 * 3_600_000 });
  });

  test('a date seconds away is the pace, for the time left', () => {
    expect(classify(date(2_000))).toEqual({ kind: 'rate-limited', retryAfterMs: 2_000 });
    expect(classify(date(59_000))).toEqual({ kind: 'rate-limited', retryAfterMs: 59_000 });
    expect(classify(date(60_000)).kind).toBe('quota-external');
  });

  test('a date more than 24 hours away is believed for 24 hours only', () => {
    expect(classify(date(5 * 24 * 3_600_000))).toEqual({ kind: 'quota-external', retryAfterMs: 24 * 3_600_000 });
  });

  test('the two old forms of an HTTP date are read too (RFC 850 and asctime, both in GMT)', () => {
    expect(parseRetryAfter('Wednesday, 18-Nov-26 15:00:00 GMT', NOW)).toBe(3 * 3_600_000);
    expect(parseRetryAfter('Wed Nov 18 15:00:00 2026', NOW)).toBe(3 * 3_600_000);
  });

  test('a date already past, or one that is not valid, is the usual short pause', () => {
    for (const header of [
      date(-60_000), 'Wed, 18 Nov 2026 11:00:00 GMT', 'Wed, 32 Nov 2026 12:00:00 GMT', 'Wed, 18 Nov 2026', 'tomorrow', 'Nov 18 2026',
      '2026-11-18T15:00:00Z', 'Wed, 18 Nov 2026 15:00:00',
    ]) {
      expect(classify(header)).toEqual({ kind: 'rate-limited', retryAfterMs: 5_000 });
    }
  });
});

describe('the body is not part of the decision: classify429 takes nothing but the header', () => {
  test('so a message naming "daily", "per day", "today" or both limits cannot block anything', () => {
    // the messages that used to decide are not even an argument; the same header gives the same answer whatever they say
    expect(classify429.length).toBe(3);
    expect(classify(null)).toEqual({ kind: 'rate-limited', retryAfterMs: 5_000 });
    expect(classify('1')).toEqual({ kind: 'rate-limited', retryAfterMs: 1_000 });
  });
});

describe('the thresholds are the ones given', () => {
  test('a longer threshold makes a minute the pace', () => {
    expect(classify429('60', NOW, { ...O, dailyAtMs: 120_000 })).toEqual({ kind: 'rate-limited', retryAfterMs: 60_000 });
    expect(classify429('120', NOW, { ...O, dailyAtMs: 120_000 }).kind).toBe('quota-external');
  });

  test('a different cap and default pause', () => {
    expect(classify429('7200', NOW, { ...O, maxBlockMs: 3_600_000 })).toEqual({ kind: 'quota-external', retryAfterMs: 3_600_000 });
    expect(classify429(null, NOW, { ...O, defaultPauseMs: 1_000 })).toEqual({ kind: 'rate-limited', retryAfterMs: 1_000 });
  });
});
