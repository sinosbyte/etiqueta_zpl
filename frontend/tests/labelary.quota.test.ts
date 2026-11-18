// Etapa 4: what the editor does with the answers about the quota of the preview service (Labelary): the codes of the
// server become a message in the language on screen with the time it is back, the state of the quota is kept and
// decides what is asked for, and room for a mass export is kept as a whole or refused. The network is a fake `fetch`.

/* eslint-disable @typescript-eslint/no-explicit-any */
// The api client reads the build's environment (import.meta), which the tests do not have: the sign-in module is replaced
jest.mock('../src/utils/authClient', () => ({ API_BASE: '', getToken: () => 'jwt', triggerOn401: jest.fn(), refreshAccessToken: jest.fn() }));

import { apiFetch, apiFetchBlob, HttpError } from '../src/utils/apiClient';
import { fetchStatus, forgetHoldForTests, holdForExport, HoldDenied, releaseHold, retryAllowance } from '../src/utils/labelaryClient';
import { parseRetryAt, whenText } from '../src/utils/quotaText';
import { mayPrefetch, previewBlocked, useLabelaryStore } from '../src/store/useLabelaryStore';
import { previewBlob } from '../src/utils/zplClient';
import { useDesignerStore } from '../src/store/useDesignerStore';
import { useLangStore, translate } from '../src/i18n';

let fetchMock: jest.SpyInstance;
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const answer = (...responses: Response[]) => { responses.forEach(r => fetchMock.mockResolvedValueOnce(r)); };

const reset = () => { useLabelaryStore.setState({ availability: 'unknown', remaining: null, retryAt: null }); forgetHoldForTests(); };

beforeEach(() => {
  fetchMock = jest.spyOn(global, 'fetch');
  useLangStore.setState({ lang: 'pt-BR' });
  reset();
});
afterEach(() => { fetchMock.mockRestore(); reset(); });

// 19 Nov 2026, 14:05 in Brasilia (UTC-3, no daylight saving time since 2019)
const AT = new Date('2026-11-19T17:05:00Z');
const SAME_DAY = new Date('2026-11-19T12:00:00Z');
const NEXT_DAY = new Date('2026-11-18T12:00:00Z');

describe('when something is available again', () => {
  test('in Brasilia time, in the language on screen, with the day only when it is not today', () => {
    expect(whenText(AT, 'pt-BR', SAME_DAY)).toBe('às 14:05');
    expect(whenText(AT, 'pt-BR', NEXT_DAY)).toBe('em 19/11 às 14:05');
    expect(whenText(AT, 'en', SAME_DAY)).toBe('at 2:05 PM');
    expect(whenText(AT, 'en', NEXT_DAY)).toBe('on 11/19 at 2:05 PM');
  });

  test('the day is the one of Brasilia, not of the browser: 01:30 there on the 20th is still the 19th in UTC', () => {
    const late = new Date('2026-11-20T04:30:00Z');                                  // 01:30 of the 20th in Brasilia
    expect(whenText(late, 'pt-BR', new Date('2026-11-20T15:00:00Z'))).toBe('às 01:30');
    expect(whenText(late, 'pt-BR', new Date('2026-11-19T15:00:00Z'))).toBe('em 20/11 às 01:30');
  });

  test('a moment from the server is read only when it is a date', () => {
    expect(parseRetryAt('2026-11-19T17:05:00.000Z')?.getTime()).toBe(AT.getTime());
    expect(parseRetryAt(null)).toBeUndefined();
    expect(parseRetryAt('later')).toBeUndefined();
    expect(parseRetryAt(12)).toBeUndefined();
  });
});

describe('the answers of the server about the quota', () => {
  const retryAt = new Date(Date.now() + 2 * 3_600_000).toISOString();

  test.each([
    [429, 'quota-internal', 'Labelary daily limit of this server reached', /limite diário de uso/],
    [429, 'quota-external', 'Labelary quota is used up for now', /atingiu a cota diária dele/],
    [503, 'quota-unavailable', 'Labelary quota control unavailable', /indisponível no momento/],
  ])('%s %s is a message of its own, says editing and saving keep working, and is not retried by the client', async (status, code, error, text) => {
    answer(json(status, { error, code, retryAt: null, remaining: 0 }));
    const e = await apiFetchBlob('/api/preview', { method: 'POST', body: '{}' }).catch(x => x);
    expect(e).toBeInstanceOf(HttpError);
    expect(e).toMatchObject({ status, code });
    expect(e.message).toMatch(text);
    expect(e.message).toMatch(/edição e o salvamento continuam normais/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('with the time it is back, the message says it, in Brasilia time', async () => {
    const at = new Date('2026-11-30T17:05:00Z');
    answer(json(429, { error: 'Labelary daily limit of this server reached', code: 'quota-internal', retryAt: at.toISOString(), remaining: 0 }, { 'Retry-After': '7200' }));
    const e = await apiFetchBlob('/api/preview', { method: 'POST', body: '{}' }).catch(x => x);
    expect(e.message).toContain('Volta a ficar disponível em 30/11 às 14:05 (horário de Brasília).');
    expect(e.retryAt?.getTime()).toBe(at.getTime());
    expect(e.retryAfterMs).toBe(7_200_000);
  });

  test('in English too', async () => {
    useLangStore.setState({ lang: 'en' });
    answer(json(429, { error: 'Labelary quota is used up for now', code: 'quota-external', retryAt: '2026-11-30T17:05:00.000Z' }));
    const e = await apiFetchBlob('/api/preview', { method: 'POST', body: '{}' }).catch(x => x);
    expect(e.message).toContain('reached its own daily quota');
    expect(e.message).toContain('It will be available again on 11/30 at 2:05 PM (Brasilia time).');
  });

  test('every other reason has its own message, not a generic one', async () => {
    const cases: [number, string, string, RegExp][] = [
      [422, 'zpl-rejected', 'The rendering service rejected this label', /não aceitou esta etiqueta/],
      [504, 'timeout', 'Labelary API timed out', /demorou demais/],
      [502, 'upstream', 'Labelary API error', /Erro na API do Labelary/],
      [502, 'network', 'Could not reach Labelary API', /Não foi possível acessar/],
      [429, 'rate-limited', 'Labelary rate limit reached, please retry later', /limite de requisições/],
      [503, 'busy', 'Labelary API busy, please retry later', /ocupado/],
    ];
    const seen = new Set<string>();
    for (const [status, code, error, text] of cases) {
      answer(json(status, { error, code }));
      const e = await apiFetchBlob('/api/preview', { method: 'POST', body: '{}' }).catch(x => x);
      expect(e).toMatchObject({ status, code });
      expect(e.message).toMatch(text);
      seen.add(e.message);
    }
    expect(seen.size).toBe(cases.length);
  });

  test('an old answer without a code still works (the message is translated as before)', async () => {
    answer(json(502, { error: 'Labelary API error' }));
    const e = await apiFetchBlob('/api/preview', { method: 'POST', body: '{}' }).catch(x => x);
    expect(e).toMatchObject({ status: 502, code: undefined });
    expect(e.message).toBe(translate('pt-BR', 'api.labelaryError'));
  });

  test('the JSON calls get the same error, with the code and what is left', async () => {
    answer(json(429, { error: 'Labelary daily limit of this server reached', code: 'quota-internal', remaining: 120, retryAt }));
    const e = await apiFetch('/api/labelary/holds', { method: 'POST', body: '{}' }).catch(x => x);
    expect(e).toBeInstanceOf(HttpError);
    expect(e).toMatchObject({ status: 429, code: 'quota-internal', remaining: 120 });
  });
});

describe('the state of the quota on screen', () => {
  test('an answer that says it is out is known everywhere, with the time it is back', async () => {
    const at = '2026-11-30T17:05:00.000Z';
    answer(json(429, { error: 'Labelary quota is used up for now', code: 'quota-external', retryAt: at, remaining: 0 }));
    await apiFetchBlob('/api/preview', { method: 'POST', body: '{}' }).catch(() => undefined);
    expect(useLabelaryStore.getState()).toMatchObject({ availability: 'blocked', remaining: 0 });
    expect(useLabelaryStore.getState().retryAt?.toISOString()).toBe(at);
  });

  test('a quota that cannot be checked is "unavailable"', async () => {
    answer(json(503, { error: 'Labelary quota control unavailable', code: 'quota-unavailable' }));
    await apiFetchBlob('/api/preview', { method: 'POST', body: '{}' }).catch(() => undefined);
    expect(useLabelaryStore.getState().availability).toBe('unavailable');
  });

  test('room for an export that did not fit does not say the quota is out (there is still some left)', async () => {
    answer(json(429, { error: 'Labelary daily limit of this server reached', code: 'quota-internal', remaining: 40 }));
    await apiFetch('/api/labelary/holds', { method: 'POST', body: '{}' }).catch(() => undefined);
    expect(useLabelaryStore.getState().availability).toBe('unknown');
  });

  test('the other failures do not change it', async () => {
    answer(json(422, { error: 'The rendering service rejected this label', code: 'zpl-rejected' }), json(502, { error: 'Labelary API error', code: 'upstream' }));
    await apiFetchBlob('/api/preview', { method: 'POST', body: '{}' }).catch(() => undefined);
    await apiFetchBlob('/api/preview', { method: 'POST', body: '{}' }).catch(() => undefined);
    expect(useLabelaryStore.getState().availability).toBe('unknown');
  });

  test('refresh reads ok, low and blocked from the server', async () => {
    answer(json(200, { state: 'ok', remaining: 3500, retryAt: null }));
    await useLabelaryStore.getState().refresh();
    expect(useLabelaryStore.getState()).toMatchObject({ availability: 'ok', remaining: 3500, retryAt: null });
    answer(json(200, { state: 'low', remaining: 120, retryAt: null }));
    await useLabelaryStore.getState().refresh();
    expect(useLabelaryStore.getState()).toMatchObject({ availability: 'low', remaining: 120 });
    answer(json(200, { state: 'blocked', remaining: 0, retryAt: '2026-11-30T17:05:00.000Z' }));
    await useLabelaryStore.getState().refresh();
    expect(useLabelaryStore.getState().availability).toBe('blocked');
    expect(useLabelaryStore.getState().retryAt?.toISOString()).toBe('2026-11-30T17:05:00.000Z');
  });

  test('a state that cannot be read is "unavailable"; no network leaves what was known', async () => {
    answer(json(200, { state: 'low', remaining: 90, retryAt: null }));
    await useLabelaryStore.getState().refresh();
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await useLabelaryStore.getState().refresh();
    expect(useLabelaryStore.getState()).toMatchObject({ availability: 'low', remaining: 90 });
    answer(json(503, { error: 'Labelary quota control unavailable', code: 'quota-unavailable' }));
    await useLabelaryStore.getState().refresh();
    expect(useLabelaryStore.getState().availability).toBe('unavailable');
  });

  test('blocked until the time it said, and unavailable until it is read again', () => {
    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 60_000);
    expect(previewBlocked({ availability: 'blocked', retryAt: future })).toBe(true);
    expect(previewBlocked({ availability: 'blocked', retryAt: past })).toBe(false);   // the time came: try again
    expect(previewBlocked({ availability: 'blocked', retryAt: null })).toBe(true);    // no time said: still blocked
    expect(previewBlocked({ availability: 'unavailable', retryAt: null })).toBe(true);
    expect(previewBlocked({ availability: 'low', retryAt: null })).toBe(false);
    expect(previewBlocked({ availability: 'ok', retryAt: null })).toBe(false);
    expect(previewBlocked({ availability: 'unknown', retryAt: null })).toBe(false);
  });

  test('the neighbours are asked ahead only while it is comfortable (or not known yet)', () => {
    expect(mayPrefetch({ availability: 'ok' })).toBe(true);
    expect(mayPrefetch({ availability: 'unknown' })).toBe(true);
    for (const a of ['low', 'blocked', 'unavailable'] as const) expect(mayPrefetch({ availability: a })).toBe(false);
  });
});

describe('the editor keeps working with the preview out', () => {
  test('editing, undoing and adding elements are untouched by the state of the quota', () => {
    useLabelaryStore.setState({ availability: 'blocked', remaining: 0, retryAt: new Date(Date.now() + 3_600_000) });
    const store = useDesignerStore.getState();
    const before = store.elements.length;
    const id = store.addElement('text', 10, 10, { value: 'still editable' });
    expect(useDesignerStore.getState().elements).toHaveLength(before + 1);
    useDesignerStore.getState().updateElement(id, { x: 99 });
    expect(useDesignerStore.getState().elements.find(e => e.id === id)?.x).toBe(99);
    useDesignerStore.getState().deleteElement(id);
    expect(useDesignerStore.getState().elements).toHaveLength(before);
  });
});

describe('room kept for a mass export', () => {
  test('the status is read as a date and the numbers it says', async () => {
    answer(json(200, { state: 'blocked', remaining: 0, retryAt: '2026-11-30T17:05:00.000Z' }));
    const s = await fetchStatus();
    expect(s.state).toBe('blocked');
    expect(s.retryAt?.toISOString()).toBe('2026-11-30T17:05:00.000Z');
  });

  test('a few extra are kept for tries that must be repeated: 10%, never less than 2 nor more than 50', () => {
    expect(retryAllowance(1)).toBe(2);
    expect(retryAllowance(8)).toBe(2);
    expect(retryAllowance(100)).toBe(10);
    expect(retryAllowance(300)).toBe(30);
    expect(retryAllowance(501)).toBe(50);
  });

  test('asks for the labels and the extra, as a whole', async () => {
    answer(json(201, { holdId: 'h1', slots: 110, expiresAt: '2026-11-19T20:00:00.000Z' }));
    await expect(holdForExport(100)).resolves.toEqual({ holdId: 'h1', slots: 110 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ count: 110 });
  });

  test('if there is room for the labels but not for the extra, it keeps just the labels', async () => {
    answer(json(429, { error: 'Labelary daily limit of this server reached', code: 'quota-internal', remaining: 104 }), json(201, { holdId: 'h2', slots: 100 }));
    await expect(holdForExport(100)).resolves.toEqual({ holdId: 'h2', slots: 100 });
    expect(fetchMock.mock.calls.map(c => JSON.parse(c[1].body).count)).toEqual([110, 100]);
  });

  test('if there is not room for the labels it is refused, with what there is and when it may be back', async () => {
    const at = '2026-11-30T17:05:00.000Z';
    answer(json(429, { error: 'Labelary daily limit of this server reached', code: 'quota-internal', remaining: 40, retryAt: at }));
    const e = await holdForExport(100).catch(x => x);
    expect(e).toBeInstanceOf(HoldDenied);
    expect(e).toMatchObject({ code: 'quota-internal', remaining: 40 });
    expect(e.retryAt?.toISOString()).toBe(at);
    expect(fetchMock).toHaveBeenCalledTimes(1);                                      // no second try with less
  });

  test('a block of the service is refused at once, with its message', async () => {
    answer(json(429, { error: 'Labelary quota is used up for now', code: 'quota-external', retryAt: '2026-11-30T17:05:00.000Z', remaining: 0 }));
    const e = await holdForExport(5).catch(x => x);
    expect(e).toMatchObject({ code: 'quota-external' });
    expect(e.message).toMatch(/cota diária dele/);
  });

  test('giving it back never fails the export: if the server cannot be reached the hold expires by itself', async () => {
    answer(new Response(null, { status: 204 }));
    await expect(releaseHold('h1')).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/labelary/holds/h1');
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await expect(releaseHold('h1')).resolves.toBeUndefined();
  });

  test('a picture of the export says which room it uses, and that it is part of a mass export', async () => {
    answer(new Response(new Blob(['png']), { status: 200 }));
    await previewBlob('^XA^XZ', 800, 600, undefined, true, 'h-7');
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers['X-Render-Hold']).toBe('h-7');
    expect(headers['X-Render-Priority']).toBe('bulk');
    answer(new Response(new Blob(['png']), { status: 200 }));
    await previewBlob('^XA^XZ', 800, 600);                                           // an ordinary preview carries neither
    const plain = fetchMock.mock.calls[1][1].headers;
    expect(plain['X-Render-Hold']).toBeUndefined();
    expect(plain['X-Render-Priority']).toBeUndefined();
  });
});

describe('a second export of the same user, and the room for exports being all taken', () => {
  const active = { error: 'An export of yours is already holding room', code: 'hold-active', retryAt: '2026-11-30T17:05:00.000Z' };
  const capacity = { error: 'Export capacity is busy, try again in a few minutes', code: 'hold-capacity', retryAt: '2026-11-30T17:05:00.000Z', remaining: 100 };

  test('"hold-active" (409) says another export of the user is running and was not affected; the quota state is not touched', async () => {
    answer(json(409, active));
    const e = await holdForExport(10).catch(x => x);
    expect(e).toBeInstanceOf(HoldDenied);
    expect(e).toMatchObject({ code: 'hold-active' });
    expect(e.message).toMatch(/Já há uma exportação sua em andamento/);
    expect(e.message).toMatch(/não foi afetada/);
    expect(fetchMock).toHaveBeenCalledTimes(1);                                      // refused; no second try, nothing released
    expect(useLabelaryStore.getState().availability).toBe('unknown');
  });

  test('"hold-capacity" (429) says the capacity for exports is busy, with when, and that single previews still work', async () => {
    answer(json(429, capacity, { 'Retry-After': '300' }));
    const e = await holdForExport(10).catch(x => x);
    expect(e).toBeInstanceOf(HoldDenied);
    expect(e).toMatchObject({ code: 'hold-capacity', remaining: 100 });
    expect(e.message).toMatch(/capacidade de exportações em lote está ocupada/);
    expect(e.message).toMatch(/pré-visualizações individuais continuam disponíveis/);
    expect(e.message).toContain('Volta a ficar disponível em 30/11 às 14:05 (horário de Brasília).');
    expect(useLabelaryStore.getState().availability).toBe('unknown');                // it is not the quota that is out
  });

  test('in English', async () => {
    useLangStore.setState({ lang: 'en' });
    answer(json(409, active));
    expect((await holdForExport(5).catch(x => x)).message).toMatch(/already running \(maybe in another tab\)/);
    answer(json(429, capacity));
    expect((await holdForExport(5).catch(x => x)).message).toMatch(/capacity for mass exports is busy/);
  });

  test('an export of THIS tab that could not give its room back is given back before the next one, once, and the next one goes on', async () => {
    answer(json(201, { holdId: 'h-old', slots: 12 }));
    await holdForExport(10);                                                         // the first export, with its room
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await releaseHold('h-old');                                                      // it could not give it back
    answer(json(409, active), new Response(null, { status: 204 }), json(201, { holdId: 'h-new', slots: 12 }));
    await expect(holdForExport(10)).resolves.toEqual({ holdId: 'h-new', slots: 12 });
    expect(fetchMock.mock.calls.map(c => `${c[1].method} ${c[0]}`)).toEqual([
      'POST /api/labelary/holds', 'DELETE /api/labelary/holds/h-old' /* the one that failed */, 'POST /api/labelary/holds', 'DELETE /api/labelary/holds/h-old', 'POST /api/labelary/holds',
    ]);
  });

  test('if the other export of the user is in another tab, this tab has nothing to give back: it is refused and releases nothing', async () => {
    answer(json(409, active));
    await expect(holdForExport(10)).rejects.toMatchObject({ code: 'hold-active' });
    expect(fetchMock.mock.calls.every(c => c[1].method === 'POST')).toBe(true);
  });

  test('the room that was given back is not remembered: a normal export does not release anything extra', async () => {
    answer(json(201, { holdId: 'h-1', slots: 5 }), new Response(null, { status: 204 }), json(409, active));
    await holdForExport(3);
    await releaseHold('h-1');
    await expect(holdForExport(3)).rejects.toMatchObject({ code: 'hold-active' });  // nothing of this tab to give back
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('texts, in both languages', () => {
  const keys = [
    'api.labelaryTimeout', 'api.labelaryRejected', 'api.quotaInternal', 'api.quotaExternal', 'api.quotaUnavailable',
    'quota.availableAt', 'quota.low', 'quota.blocked', 'quota.unavailable', 'quota.exportOne', 'quota.exportBlocked',
    'pdf.estimate', 'pdf.noRoom', 'pdf.quotaBlocked', 'api.holdActive', 'api.holdCapacity', 'api.holdTooLarge',
  ] as const;

  test.each(['pt-BR', 'en'] as const)('every key has a text in %s', lang => {
    for (const key of keys) expect(translate(lang, key)).not.toBe(key);
  });

  test('what is blocked says that editing, saving, the simulation and the ZPL keep working', () => {
    expect(translate('pt-BR', 'quota.blocked')).toMatch(/edição, o salvamento, a simulação e o ZPL continuam funcionando/);
    expect(translate('en', 'quota.blocked')).toMatch(/Editing, saving, the simulation and the ZPL keep working/);
  });

  test('the low-quota note says what is left, calmly, and what an export costs', () => {
    expect(translate('pt-BR', 'quota.low', { remaining: 120 })).toContain('120');
    expect(translate('pt-BR', 'quota.low', { remaining: 120 })).not.toMatch(/!|erro|crítico/i);
    expect(translate('pt-BR', 'pdf.estimate', { n: 80, remaining: 300 })).toMatch(/80.*300/);
  });
});
