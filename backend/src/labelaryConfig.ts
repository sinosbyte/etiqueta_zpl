/**
 * The limits of the use of the Labelary service, read from the environment and CHECKED at start-up.
 *
 * A limit that is wrong must not be replaced by a default in silence, because the protection of the quota depends on it:
 * 0 or 0.5 would block everything, and 40000 would let the server pass what the service allows. So a variable that is
 * set and is not what it should be stops the application from starting, with a message that says which and why. A
 * variable that is not set takes its default.
 */

/** What the public service allows in a day (labelary.com/service.html, free plan). The limit of the server never goes above it. */
export const OFFICIAL_DAILY_LIMIT = 5_000;
/** The default: 80% of the official limit. The rest covers what the service does not document (see config.ts). */
export const DEFAULT_DAILY_LIMIT = 4_000;
/**
 * The most room that may be held at once for mass exports, all users together (30% of the default limit). It is FIXED:
 * no environment variable changes it (there is none), so nothing in the configuration can raise it. The room really
 * held is the smaller of this and the daily limit (see readLabelaryLimits).
 */
export const MAX_GLOBAL_HOLD_SLOTS = 1_200;
/** Room one user may hold (a PDF of up to 501 labels and the tries that may have to be repeated). */
export const HOLD_MAX_PER_USER = 600;

export interface LabelaryLimits {
  dailyLimit: number;       // requests in any window of 24 hours, all users together
  lowThreshold: number;     // at or below this many left the state is 'low'
  holdLimit: number;        // requests that may be held at once for exports, all users together
  holdMaxPerUser: number;   // requests one user may hold
}

/** A whole number from the environment; undefined when the variable is not set; an Error when it is set and wrong. */
function readInteger(env: NodeJS.ProcessEnv, name: string, min: number, max: number): number | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  const text = raw.trim();
  const n = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}, and it is ${JSON.stringify(raw)}`);
  }
  return n;
}

export function readLabelaryLimits(env: NodeJS.ProcessEnv = process.env): LabelaryLimits {
  const dailyLimit = readInteger(env, 'LABELARY_DAILY_LIMIT', 1, OFFICIAL_DAILY_LIMIT) ?? DEFAULT_DAILY_LIMIT;
  const lowThreshold = readInteger(env, 'LABELARY_LOW_THRESHOLD', 0, dailyLimit)
    ?? Math.min(dailyLimit, Math.max(1, Math.ceil(dailyLimit * 0.1)));
  // Not read from the environment: min(1,200, daily limit), and one user never more than 600 of it
  const holdLimit = Math.min(MAX_GLOBAL_HOLD_SLOTS, dailyLimit);
  return { dailyLimit, lowThreshold, holdLimit, holdMaxPerUser: Math.min(HOLD_MAX_PER_USER, holdLimit) };
}
