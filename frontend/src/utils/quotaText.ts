// How a moment is said to the user in the messages about the preview quota: in Brasilia time (the people who use the
// app are there), in the language on screen, and as short as it can be ("at 14:05"; with the day only when it is not today).

const ZONE = 'America/Sao_Paulo';

type Lang = 'pt-BR' | 'en';

const parts = (d: Date, lang: Lang) => {
  const fmt = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(lang === 'pt-BR' ? 'pt-BR' : 'en-US', { timeZone: ZONE, ...options }).format(d);
  return {
    time: fmt({ hour: lang === 'pt-BR' ? '2-digit' : 'numeric', minute: '2-digit', hour12: lang !== 'pt-BR' }),
    day: fmt({ day: '2-digit', month: '2-digit' }),
    dayKey: fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }),
  };
};

/** "às 14:05" / "em 19/11 às 14:05" (pt-BR) and "at 2:05 PM" / "on 11/19 at 2:05 PM" (en), in Brasilia time. */
export function whenText(at: Date, lang: Lang, now: Date = new Date()): string {
  const a = parts(at, lang);
  const sameDay = a.dayKey === parts(now, lang).dayKey;
  if (lang === 'pt-BR') return sameDay ? `às ${a.time}` : `em ${a.day} às ${a.time}`;
  return sameDay ? `at ${a.time}` : `on ${a.day} at ${a.time}`;
}

/** The moment an answer of the server says (an ISO text), or undefined when there is none or it is not a date. */
export function parseRetryAt(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
