/**
 * What an HTTP 429 from the Labelary service means, from the only reliable thing it says: the Retry-After header.
 *
 * The service answers 429 both for going too fast (per second) and for using up its daily quota, and its text can mention
 * both limits at once ("3 requests per second (5,000 per day)"). The words of the body therefore say nothing sure, and
 * they are NOT read: a message that happens to name the daily limit must not shut the service off for an hour. What decides
 * is how long the service asks to wait:
 *  - a wait of the minute or more (`dailyAtMs`) is the daily quota: the server stays away for that long (never more than
 *    `maxBlockMs`, the quota being daily) and remembers it for every instance;
 *  - a shorter wait is only the pace: the server waits that long and tries again;
 *  - no Retry-After, or one that cannot be understood, is treated as the pace, with the usual short pause (`defaultPauseMs`).
 *
 * Retry-After comes in two forms (RFC 9110): a number of seconds, or an HTTP date. Both are read; anything else is not valid.
 */

export interface Classify429Options {
  dailyAtMs: number;         // a wait of at least this long is the daily quota
  maxBlockMs: number;        // the longest a block is believed
  defaultPauseMs: number;    // the pause when there is no usable Retry-After
}

export type Classified =
  | { kind: 'quota-external'; retryAfterMs: number }
  | { kind: 'rate-limited'; retryAfterMs: number };

const DAYS = '(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)';
const LONG_DAYS = '(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)';
const MONTHS = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
// The three forms of an HTTP date (RFC 9110, 5.6.7): the preferred one and the two old ones, all in GMT
const IMF_FIXDATE = new RegExp(`^${DAYS}, \\d{2} ${MONTHS} \\d{4} \\d{2}:\\d{2}:\\d{2} GMT$`);
const RFC850_DATE = new RegExp(`^${LONG_DAYS}, \\d{2}-${MONTHS}-\\d{2} \\d{2}:\\d{2}:\\d{2} GMT$`);
const ASCTIME_DATE = new RegExp(`^${DAYS} ${MONTHS} [ \\d]\\d \\d{2}:\\d{2}:\\d{2} \\d{4}$`);

/** The wait a Retry-After asks for, in ms; undefined when it is absent, empty, not valid, zero or a date already past. */
export function parseRetryAfter(value: string | null | undefined, nowMs: number): number | undefined {
  if (value === null || value === undefined) return undefined;
  const text = value.trim();
  if (text === '') return undefined;

  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    return Number.isSafeInteger(seconds) && seconds > 0 ? seconds * 1000 : undefined;
  }

  if (IMF_FIXDATE.test(text) || RFC850_DATE.test(text) || ASCTIME_DATE.test(text)) {
    const at = Date.parse(text.endsWith('GMT') ? text : `${text} GMT`);
    if (!Number.isFinite(at)) return undefined;
    const wait = at - nowMs;
    return wait > 0 ? wait : undefined;
  }

  return undefined;   // -5, 1.5, abc, an impossible date...
}

export function classify429(retryAfter: string | null | undefined, nowMs: number, o: Classify429Options): Classified {
  const asked = parseRetryAfter(retryAfter, nowMs);
  if (asked === undefined) return { kind: 'rate-limited', retryAfterMs: o.defaultPauseMs };
  if (asked >= o.dailyAtMs) return { kind: 'quota-external', retryAfterMs: Math.min(asked, o.maxBlockMs) };
  return { kind: 'rate-limited', retryAfterMs: asked };
}
