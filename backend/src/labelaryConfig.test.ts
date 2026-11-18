import { DEFAULT_DAILY_LIMIT, MAX_GLOBAL_HOLD_SLOTS, HOLD_MAX_PER_USER, OFFICIAL_DAILY_LIMIT, readLabelaryLimits } from './labelaryConfig';

/**
 * The limits of the use of Labelary are checked when the application starts: a value that is set and wrong stops it,
 * with a message, instead of being replaced by a default in silence (the protection of the quota depends on it).
 */

const read = (env: Record<string, string | undefined>) => readLabelaryLimits(env as NodeJS.ProcessEnv);

describe('LABELARY_DAILY_LIMIT', () => {
  test('not set: 4,000, 10% as the low threshold, 1,200 that may be held (30%), 600 for one user', () => {
    expect(read({})).toEqual({ dailyLimit: 4_000, lowThreshold: 400, holdLimit: 1_200, holdMaxPerUser: 600 });
    expect([DEFAULT_DAILY_LIMIT, MAX_GLOBAL_HOLD_SLOTS, HOLD_MAX_PER_USER, OFFICIAL_DAILY_LIMIT]).toEqual([4_000, 1_200, 600, 5_000]);
  });

  test.each([['1', 1], ['4000', 4_000], ['5000', 5_000], ['  300  ', 300], ['0042', 42]])('%s is accepted as %s', (value, expected) => {
    expect(read({ LABELARY_DAILY_LIMIT: value }).dailyLimit).toBe(expected);
  });

  test.each([
    ['0'], ['-5'], ['0.5'], ['1.9'], ['abc'], [''], ['   '], ['5001'], ['40000'], ['1e12'], ['1e400'], ['Infinity'], ['NaN'], ['4,000'], ['4000 requests'],
    ['+10'], ['0x10'], ['99999999999999999999'],
  ])('%j stops the start-up, with a message that names the variable and what is expected', value => {
    expect(() => read({ LABELARY_DAILY_LIMIT: value })).toThrow(/LABELARY_DAILY_LIMIT must be a whole number from 1 to 5000/);
  });

  test('the message says what was found', () => {
    expect(() => read({ LABELARY_DAILY_LIMIT: '40000' })).toThrow('and it is "40000"');
  });
});

describe('LABELARY_LOW_THRESHOLD', () => {
  test('not set: 10% of the limit, at least 1, and never above the limit', () => {
    expect(read({ LABELARY_DAILY_LIMIT: '3' }).lowThreshold).toBe(1);
    expect(read({ LABELARY_DAILY_LIMIT: '1' }).lowThreshold).toBe(1);
    expect(read({ LABELARY_DAILY_LIMIT: '50' }).lowThreshold).toBe(5);
    expect(read({ LABELARY_DAILY_LIMIT: '5000' }).lowThreshold).toBe(500);
  });

  test.each([['0', 0], ['1', 1], ['400', 400], ['4000', 4_000]])('%s is accepted', (value, expected) => {
    expect(read({ LABELARY_LOW_THRESHOLD: value }).lowThreshold).toBe(expected);
  });

  test('zero is allowed (the state is never "low"), a value above the limit is not', () => {
    expect(read({ LABELARY_DAILY_LIMIT: '100', LABELARY_LOW_THRESHOLD: '100' }).lowThreshold).toBe(100);
    expect(() => read({ LABELARY_DAILY_LIMIT: '100', LABELARY_LOW_THRESHOLD: '101' })).toThrow(/LABELARY_LOW_THRESHOLD must be a whole number from 0 to 100/);
  });

  test.each([['-1'], ['0.5'], ['1.9'], ['abc'], [''], ['1e3'], ['4001']])('%j stops the start-up', value => {
    expect(() => read({ LABELARY_LOW_THRESHOLD: value })).toThrow(/LABELARY_LOW_THRESHOLD must be a whole number from 0 to 4000/);
  });
});

describe('room that may be held for exports (fixed ceiling: min(1,200, daily limit); one user min(600, that))', () => {
  test.each([
    ['4000', 1_200, 600],
    ['5000', 1_200, 600],
    ['1000', 1_000, 600],
    ['100', 100, 100],
    ['3', 3, 3],
    ['1', 1, 1],
    ['1200', 1_200, 600],
    ['1201', 1_200, 600],
  ])('daily limit %s: %i held in all, %i for one user', (daily, global, perUser) => {
    expect(read({ LABELARY_DAILY_LIMIT: daily })).toMatchObject({ holdLimit: global, holdMaxPerUser: perUser });
  });

  test('not set: 1,200 in all and 600 for one user', () => {
    expect(read({})).toMatchObject({ holdLimit: 1_200, holdMaxPerUser: 600 });
    expect(MAX_GLOBAL_HOLD_SLOTS).toBe(1_200);
  });

  test('one user never holds more than 600, nor more than all together may, for every daily limit', () => {
    for (let daily = 1; daily <= 5_000; daily += daily < 50 ? 1 : 37) {
      const l = read({ LABELARY_DAILY_LIMIT: String(daily) });
      expect(l.holdMaxPerUser).toBeLessThanOrEqual(600);
      expect(l.holdMaxPerUser).toBeLessThanOrEqual(l.holdLimit);
      expect(l.holdLimit).toBeLessThanOrEqual(1_200);
      expect(l.holdLimit).toBeLessThanOrEqual(daily);
    }
  });

  test('LABELARY_HOLD_LIMIT does nothing: not to raise it, not to lower it, not even a wrong value', () => {
    for (const value of ['5000', '4000', '1201', '99999', '1', '0', '-1', 'abc', '']) {
      expect(read({ LABELARY_HOLD_LIMIT: value })).toEqual(read({}));
      expect(read({ LABELARY_DAILY_LIMIT: '5000', LABELARY_HOLD_LIMIT: value })).toMatchObject({ holdLimit: 1_200, holdMaxPerUser: 600 });
    }
    expect(read({ LABELARY_HOLD_MAX_PER_USER: '5000', LABELARY_HOLD_MAX_SLOTS: '5000', LABELARY_MAX_GLOBAL_HOLD_SLOTS: '5000' })).toEqual(read({}));
  });
});

describe('the application does not start with a wrong value', () => {
  const load = (env: Record<string, string>) => {
    const before = { ...process.env };
    Object.assign(process.env, env);
    try {
      let loaded: unknown;
      jest.isolateModules(() => { loaded = require('./config'); });
      return loaded as { LABELARY_DAILY_LIMIT: number; LABELARY_LOW_THRESHOLD: number; LABELARY_HOLD_LIMIT: number; LABELARY_HOLD_MAX_PER_USER: number };
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
      Object.assign(process.env, before);
    }
  };

  test('importing the configuration (what starting the server does) throws', () => {
    expect(() => load({ LABELARY_DAILY_LIMIT: '40000' })).toThrow(/LABELARY_DAILY_LIMIT must be a whole number/);
    expect(() => load({ LABELARY_DAILY_LIMIT: '0.5' })).toThrow(/LABELARY_DAILY_LIMIT/);
    expect(() => load({ LABELARY_DAILY_LIMIT: '' })).toThrow(/LABELARY_DAILY_LIMIT/);
  });

  test('a good value is the one the application uses', () => {
    const c = load({ LABELARY_DAILY_LIMIT: '250', LABELARY_LOW_THRESHOLD: '20' });
    expect([c.LABELARY_DAILY_LIMIT, c.LABELARY_LOW_THRESHOLD, c.LABELARY_HOLD_LIMIT, c.LABELARY_HOLD_MAX_PER_USER]).toEqual([250, 20, 250, 250]);
  });

  test('the configuration the server uses: daily 5000 gives 1,200 / 600, and LABELARY_HOLD_LIMIT=5000 changes nothing', () => {
    const c = load({ LABELARY_DAILY_LIMIT: '5000', LABELARY_HOLD_LIMIT: '5000' });
    expect([c.LABELARY_HOLD_LIMIT, c.LABELARY_HOLD_MAX_PER_USER]).toEqual([1_200, 600]);
    const d = load({ LABELARY_HOLD_LIMIT: '4000' });
    expect([d.LABELARY_DAILY_LIMIT, d.LABELARY_HOLD_LIMIT, d.LABELARY_HOLD_MAX_PER_USER]).toEqual([4_000, 1_200, 600]);
  });
});
