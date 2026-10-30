// ^GFA graphic field data (ASCII hex, optionally with ZPL compression).

// ^GFA data without line breaks, as emitted back into the ZPL
export const compactGraphicData = (data: string): string => data.replace(/\s+/g, '');

// Repeat counts: G..Y = 1..19, g..z = 20..400 in steps of 20
const COUNTS: Record<string, number> = {};
for (let i = 0; i < 19; i++) COUNTS[String.fromCharCode(71 + i)] = i + 1;
for (let i = 0; i < 20; i++) COUNTS[String.fromCharCode(103 + i)] = (i + 1) * 20;

/**
 * Decodes ^GFA data into rows of hex digits (bytesPerRow * 2 each). In the
 * compressed form a count letter repeats the next hex digit, "," fills the rest
 * of the row with 0, "!" with 1 and ":" repeats the previous row.
 * Returns null when the data is not valid ^GFA data.
 */
export function decodeGraphicRows(data: string, bytesPerRow: number): string[] | null {
  const rowLength = bytesPerRow * 2;
  if (rowLength <= 0) return null;
  const rows: string[] = [];
  let row = '';
  let count = 0;
  const endRow = (fill: string) => {
    rows.push(row + fill.repeat(rowLength - row.length));
    row = '';
  };
  for (const ch of compactGraphicData(data)) {
    if (COUNTS[ch] !== undefined) { count += COUNTS[ch]; continue; }
    if (/[0-9A-Fa-f]/.test(ch)) {
      row += ch.toUpperCase().repeat(Math.max(1, count));
      count = 0;
      if (row.length > rowLength) return null;
      if (row.length === rowLength) endRow('');
      continue;
    }
    if (count > 0) return null;
    if (ch === ',') { endRow('0'); continue; }
    if (ch === '!') { endRow('F'); continue; }
    if (ch === ':') {
      if (row !== '' || rows.length === 0) return null;
      rows.push(rows[rows.length - 1]);
      continue;
    }
    return null;
  }
  if (count > 0) return null;
  if (row !== '') endRow('0');
  return rows;
}
