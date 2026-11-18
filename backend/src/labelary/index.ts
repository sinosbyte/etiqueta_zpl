import {
  LABELARY_CONCURRENCY, LABELARY_DAILY_LIMIT, LABELARY_HOLD_LIMIT, LABELARY_HOLD_MAX_PER_USER, LABELARY_HOLD_TTL_MS, LABELARY_LOW_THRESHOLD,
  LABELARY_MAX_QUEUED, LABELARY_MAX_QUEUED_PER_USER, LABELARY_QUEUE_MAX_WAIT_MS, LABELARY_RATE_PER_SECOND,
} from '../config';
import { LabelaryGate } from './gate';
import { LabelaryQuota } from './quota';

/** The one gate of this server: every request to Labelary, from every user, goes through it. */
export const labelaryGate = new LabelaryGate({
  ratePerSecond: LABELARY_RATE_PER_SECOND,
  concurrency: LABELARY_CONCURRENCY,
  maxWaitMs: LABELARY_QUEUE_MAX_WAIT_MS,
  maxQueuedPerUser: LABELARY_MAX_QUEUED_PER_USER,
  maxQueued: LABELARY_MAX_QUEUED,
});

/** The use of the service over the last 24 hours, kept in the database (see labelary/quota.ts). */
export const labelaryQuota = new LabelaryQuota({
  limit: LABELARY_DAILY_LIMIT,
  lowThreshold: LABELARY_LOW_THRESHOLD,
  holdTtlMs: LABELARY_HOLD_TTL_MS,
  holdLimit: LABELARY_HOLD_LIMIT,
  holdMaxPerUser: LABELARY_HOLD_MAX_PER_USER,
});
