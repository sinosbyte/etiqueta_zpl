import { sql } from 'drizzle-orm';
import { DrizzleDb, getDb } from '../db/database';
import logger from '../logger';

/**
 * How much of the Labelary service the server may still use, kept in PostgreSQL so that it is the same for every
 * instance and survives a restart (the container is replaced at each deploy, so memory would start from zero).
 *
 * THE RULE: in any window of 24 hours the server sends at most `limit` requests to the service, whatever the number of
 * users, instances or concurrent requests, and whatever the time zone or the moment the service resets its own day.
 *
 * HOW: every request actually sent is one row with the exact time it was sent (labelary_requests). Asking for room
 * (reserve) is one transaction that first takes a lock shared by everyone, then counts the rows of the last 24 hours,
 * and writes its own row only if the count is below the limit. Because of the lock, two requests never count at the same
 * time, so none can slip in beside another and nothing is lost. Why this never lets the limit be passed: take any window
 * of 24 hours and the last request in it, sent at time T. When that request was written, the rows in [T - 24h, T] were
 * counted and were fewer than the limit, so with it they were at most the limit; every other request of the window is in
 * [T - 24h, T]. The count is closed at the old end (>=) so a request exactly 24 hours old still counts. The clock is the
 * database's (clock_timestamp), the same for every instance; the lock makes the order of the rows the order of the times.
 *
 * HOLDS: a mass export (a PDF of hundreds of labels) asks first for all the room it will need (createHold). That room
 * counts against the limit at once, so the export either has room to finish or is refused before it starts; each label it
 * then sends takes one of its slots (the count does not change: a slot becomes a row). What is not used is given back
 * (releaseHold, or the hold expires). Three rules keep holds from hurting anyone:
 *  - a user has ONE hold at a time, and asking for another is refused ('hold-active'): the hold in use is never replaced,
 *    shortened, renewed or touched, so an export that has its room keeps it until it ends, is released or expires;
 *  - a user may hold at most `holdMaxPerUser` (600) and all users together at most `holdLimit` (1,200 = 30% of the
 *    default limit), so idle holds cannot take the quota: the rest is refused as a whole ('hold-too-large', 'hold-capacity');
 *  - what is held plus what was used never passes the limit (the invariant above).
 * All of it is decided inside the same transaction, under the same lock, as every count.
 *
 * BLOCK: when the service itself says its daily quota is used up, blockUntil records it; until then every reserve is refused.
 *
 * FAILURE: if the database cannot be reached the answer is 'quota-unavailable' (nothing is sent): the preview is a help,
 * and a quota that cannot be checked is treated as used.
 */

export type DeniedReason =
  | 'quota-internal' | 'quota-external' | 'quota-unavailable'
  | 'hold-active'      // the user already has a hold in use
  | 'hold-capacity'    // the room that may be held at once, by everybody, is taken
  | 'hold-too-large';  // more than one user may hold

export interface Denied {
  ok: false;
  reason: DeniedReason;
  retryAt: Date | null;     // the earliest moment there may be room again (null when unknown)
  remaining: number;        // requests left, for the message
}

export interface Reserved { ok: true }

export type QuotaState = 'ok' | 'low' | 'blocked';

export interface QuotaStatus {
  state: QuotaState;
  remaining: number;        // room not used and not held, all users together
  retryAt: Date | null;     // set when blocked
}

export interface HoldGranted { ok: true; holdId: string; slots: number; expiresAt: Date }

export interface QuotaOptions {
  limit: number;
  lowThreshold: number;
  holdTtlMs: number;
  holdLimit?: number;       // room that may be held at once, all users together (default: the limit)
  holdMaxPerUser?: number;  // room one user may hold (default: the limit)
  db?: () => DrizzleDb;     // for tests
}

// A key for pg_advisory_xact_lock: one lock for the whole quota
const LOCK_KEY = 7_240_913;
const WINDOW = sql.raw("interval '24 hours'");
const RETENTION = sql.raw("interval '25 hours'");   // the window and an hour of slack
const CLEAN_EVERY_MS = 60 * 60 * 1000;

type Runner = Pick<DrizzleDb, 'execute'>;

interface Snapshot { used: number; held: number; block: Date | null }

export class LabelaryQuota {
  private lastClean = 0;

  constructor(private readonly o: QuotaOptions) {}

  private db(): DrizzleDb { return (this.o.db ?? getDb)(); }

  private async locked<T>(fn: (q: Runner) => Promise<T>): Promise<T> {
    return this.db().transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_KEY})`);
      return fn(tx);
    });
  }

  /** What is used and held now, and the block if there is one (the database's clock). */
  private async snapshot(q: Runner): Promise<Snapshot> {
    const r = await q.execute(sql`
      SELECT
        (SELECT count(*) FROM labelary_requests WHERE sent_at >= clock_timestamp() - ${WINDOW}) AS used,
        (SELECT COALESCE(sum(slots), 0) FROM labelary_holds WHERE expires_at > clock_timestamp()) AS held,
        (SELECT until FROM labelary_block WHERE id = 1 AND until > clock_timestamp()) AS block`);
    const row = r.rows[0] as { used: string | number; held: string | number; block: Date | null };
    return { used: Number(row.used), held: Number(row.held), block: row.block ? new Date(row.block) : null };
  }

  /**
   * The earliest moment room could come back when `need` of the units now counted (requests and holds) have to go: the
   * moment the need-th oldest request leaves the window, or the first hold expires, whichever is first.
   */
  private async whenFree(q: Runner, used: number, held: number, need: number): Promise<Date | null> {
    const candidates: Date[] = [];
    if (need >= 1 && need <= used) {
      const r = await q.execute(sql`
        SELECT sent_at + ${WINDOW} AS at FROM labelary_requests
        WHERE sent_at >= clock_timestamp() - ${WINDOW} ORDER BY sent_at ASC OFFSET ${need - 1} LIMIT 1`);
      const at = (r.rows[0] as { at?: Date } | undefined)?.at;
      if (at) candidates.push(new Date(at));
    }
    if (held > 0) {
      const r = await q.execute(sql`SELECT min(expires_at) AS at FROM labelary_holds WHERE expires_at > clock_timestamp()`);
      const at = (r.rows[0] as { at?: Date | null } | undefined)?.at;
      if (at) candidates.push(new Date(at));
    }
    return candidates.length ? new Date(Math.min(...candidates.map(d => d.getTime()))) : null;
  }

  private denied(reason: DeniedReason, retryAt: Date | null, remaining: number): Denied {
    return { ok: false, reason, retryAt, remaining: Math.max(0, remaining) };
  }

  private async cleanIfDue(q: Runner): Promise<void> {
    const now = Date.now();
    if (now - this.lastClean < CLEAN_EVERY_MS) return;
    this.lastClean = now;
    await q.execute(sql`DELETE FROM labelary_requests WHERE sent_at < clock_timestamp() - ${RETENTION}`);
    await q.execute(sql`DELETE FROM labelary_holds WHERE expires_at <= clock_timestamp()`);
  }

  /**
   * Room for ONE request that is about to be sent, and the row that says it was sent. With a hold of the user's that
   * still has a slot, the slot is used (and the hold's time is extended); otherwise it takes room that is free.
   */
  async reserve(userId: number | null, holdId?: string): Promise<Reserved | Denied> {
    try {
      return await this.locked(async q => {
        await this.cleanIfDue(q);
        const s = await this.snapshot(q);
        if (s.block) return this.denied('quota-external', s.block, 0);

        if (holdId && userId !== null) {
          const h = await q.execute(sql`
            UPDATE labelary_holds
            SET slots = slots - 1, expires_at = clock_timestamp() + (${this.o.holdTtlMs}::double precision * interval '1 millisecond')
            WHERE id = ${holdId} AND user_id = ${userId} AND slots > 0 AND expires_at > clock_timestamp()
            RETURNING id`);
          if (h.rows.length > 0) {
            await q.execute(sql`INSERT INTO labelary_requests (sent_at, user_id) VALUES (clock_timestamp(), ${userId})`);
            return { ok: true } as Reserved;
          }
          // No such hold, or it is used up or expired: the request is an ordinary one
        }

        const free = this.o.limit - s.used - s.held;
        if (free <= 0) {
          return this.denied('quota-internal', await this.whenFree(q, s.used, s.held, s.used + s.held - this.o.limit + 1), free);
        }
        await q.execute(sql`INSERT INTO labelary_requests (sent_at, user_id) VALUES (clock_timestamp(), ${userId})`);
        return { ok: true } as Reserved;
      });
    } catch (e) {
      logger.error({ err: e }, 'Labelary quota could not be checked: nothing is sent');
      return this.denied('quota-unavailable', null, 0);
    }
  }

  /** The state for the screen. Throws when the database cannot be read (the caller says it is unavailable). */
  async status(): Promise<QuotaStatus> {
    const q = this.db();
    const s = await this.snapshot(q);
    const remaining = Math.max(0, this.o.limit - s.used - s.held);
    if (s.block) return { state: 'blocked', remaining, retryAt: s.block };
    if (remaining <= 0) {
      return { state: 'blocked', remaining: 0, retryAt: await this.whenFree(q, s.used, s.held, s.used + s.held - this.o.limit + 1) };
    }
    return { state: remaining <= this.o.lowThreshold ? 'low' : 'ok', remaining, retryAt: null };
  }

  /**
   * Keeps `count` requests of room for a mass export of the user, as a whole or not at all. Refused (and nothing is touched) when
   * the user already has a hold in use, when `count` is more than one user may hold, when the room that may be held at once
   * is taken, or when there is not that much room in the quota. A hold of the user that EXPIRED is cleared first: it holds
   * nothing and is of no use to anybody.
   */
  async createHold(userId: number, count: number): Promise<HoldGranted | Denied> {
    const holdLimit = this.o.holdLimit ?? this.o.limit;
    const maxPerUser = Math.min(this.o.holdMaxPerUser ?? this.o.limit, holdLimit);
    try {
      return await this.locked(async q => {
        await this.cleanIfDue(q);
        const s = await this.snapshot(q);
        if (s.block) return this.denied('quota-external', s.block, 0);

        await q.execute(sql`DELETE FROM labelary_holds WHERE user_id = ${userId} AND expires_at <= clock_timestamp()`);
        const own = await q.execute(sql`SELECT expires_at FROM labelary_holds WHERE user_id = ${userId}`);
        if (own.rows.length > 0) {
          const until = (own.rows[0] as { expires_at: Date }).expires_at;
          return this.denied('hold-active', new Date(until), this.o.limit - s.used - s.held);
        }
        if (count > maxPerUser) return this.denied('hold-too-large', null, maxPerUser);
        if (s.held + count > holdLimit) return this.denied('hold-capacity', await this.whenFree(q, 0, s.held, 1), holdLimit - s.held);

        const free = this.o.limit - s.used - s.held;
        if (count > free) {
          return this.denied('quota-internal', await this.whenFree(q, s.used, s.held, s.used + s.held + count - this.o.limit), free);
        }
        const r = await q.execute(sql`
          INSERT INTO labelary_holds (user_id, slots, created_at, expires_at)
          VALUES (${userId}, ${count}, clock_timestamp(), clock_timestamp() + (${this.o.holdTtlMs}::double precision * interval '1 millisecond'))
          RETURNING id, expires_at`);
        const row = r.rows[0] as { id: string; expires_at: Date };
        return { ok: true, holdId: row.id, slots: count, expiresAt: new Date(row.expires_at) } as HoldGranted;
      });
    } catch (e) {
      logger.error({ err: e }, 'Labelary quota could not be checked: no room was kept');
      return this.denied('quota-unavailable', null, 0);
    }
  }

  /** Gives back what a hold did not use. Safe to call twice, or for a hold that expired. */
  async releaseHold(userId: number, holdId: string): Promise<void> {
    await this.db().execute(sql`DELETE FROM labelary_holds WHERE id = ${holdId} AND user_id = ${userId}`);
  }

  /** The service said its own quota is used up: nothing is sent until then (never shortened by a later, shorter answer). */
  async blockUntil(ms: number, reason: string): Promise<void> {
    await this.db().execute(sql`
      INSERT INTO labelary_block (id, until, reason, set_at)
      VALUES (1, clock_timestamp() + (${ms}::double precision * interval '1 millisecond'), ${reason}, clock_timestamp())
      ON CONFLICT (id) DO UPDATE
      SET until = GREATEST(labelary_block.until, EXCLUDED.until), reason = EXCLUDED.reason, set_at = EXCLUDED.set_at`);
  }
}
