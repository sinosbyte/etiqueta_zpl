import {
  LABELARY_CONCURRENCY, LABELARY_MAX_QUEUED, LABELARY_MAX_QUEUED_PER_USER, LABELARY_QUEUE_MAX_WAIT_MS, LABELARY_RATE_PER_SECOND,
} from '../config';
import { LabelaryGate } from './gate';

/** The one gate of this server: every request to Labelary, from every user, goes through it. */
export const labelaryGate = new LabelaryGate({
  ratePerSecond: LABELARY_RATE_PER_SECOND,
  concurrency: LABELARY_CONCURRENCY,
  maxWaitMs: LABELARY_QUEUE_MAX_WAIT_MS,
  maxQueuedPerUser: LABELARY_MAX_QUEUED_PER_USER,
  maxQueued: LABELARY_MAX_QUEUED,
});
