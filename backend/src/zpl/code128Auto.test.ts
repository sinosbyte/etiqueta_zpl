import { generateZpl } from './generator';
import { parseZpl } from './parser';
import { code128AutoSymbols, code128Modules } from './code128';
import { GenerateRequest } from './types';

const label = (el: Record<string, unknown>): GenerateRequest => ({
  labelWidth: 800,
  labelHeight: 600,
  elements: [{ id: 'b', type: 'barcode128', x: 27, y: 449, width: 300, height: 80, moduleWidth: 3, ...el } as never],
});

describe('Code 128 mode A (automatic)', () => {
  test('without codeAuto the ZPL is exactly what it was before (mode N, no sixth parameter)', () => {
    const zpl = generateZpl(label({ value: '12345678910' }));
    expect(zpl).toContain('^FO27,449^BY3^BCN,80,Y,N,N^FD12345678910^FS');
    expect(zpl).not.toContain(',A^FD');
  });

  test('codeAuto adds the mode A parameter and no start code', () => {
    const zpl = generateZpl(label({ value: '{{UC}}', codeAuto: true, codeSet: 'C' }));
    expect(zpl).toContain('^FO27,449^BY3^BCN,80,Y,N,N,A^FD{{UC}}^FS');
    expect(zpl).not.toContain('>;');
  });

  test('round-trips: the parser reads mode A back as an editable barcode', () => {
    const zpl = generateZpl(label({ value: '{{UC}}', dynamic: true, variableName: 'UC', codeAuto: true, printLine: false }));
    const parsed = parseZpl(zpl);
    expect(parsed.elements).toHaveLength(1);
    expect(parsed.elements[0]).toMatchObject({ type: 'barcode128', codeAuto: true, moduleWidth: 3, printLine: false });
    expect(generateZpl({ ...label({}), elements: parsed.elements })).toContain('^BY3^BCN,80,N,N,N,A^FD{{UC}}^FS');
  });

  test('mode N (and no mode) is read back without codeAuto', () => {
    const parsed = parseZpl('^XA\n^FO10,10^BY2^BCN,80,Y,N,N^FD123^FS\n^XZ');
    expect(parsed.elements[0].type).toBe('barcode128');
    expect(parsed.elements[0].codeAuto).toBeUndefined();
  });

  test('other modes and invocation codes in mode A stay raw', () => {
    expect(parseZpl('^XA\n^FO10,10^BY2^BCN,80,Y,N,N,U^FD123^FS\n^XZ').elements[0].type).toBe('raw');
    expect(parseZpl('^XA\n^FO10,10^BY2^BCN,80,Y,N,N,A^FD>;1234^FS\n^XZ').elements[0].type).toBe('raw');
  });

  test('the width in mode A follows the packing in subset C', () => {
    // 20 digits: 10 symbols; the default mode needs 20
    expect(code128Modules('12345678901234567890', undefined, undefined, true)).toBe(11 * 10 + 35);
    expect(code128Modules('12345678901234567890')).toBe(11 * 20 + 35);
    // 19 digits: 9 symbols, a switch and the last digit
    expect(code128Modules('1234567890123456789', undefined, undefined, true)).toBe(11 * 11 + 35);
    // a {{variable}} is assumed to be digits
    expect(code128Modules('{{UC}}', undefined, 20, true)).toBe(11 * 10 + 35);
    // the default for a variable is unchanged
    expect(code128Modules('{{UC}}', undefined, 20)).toBe(11 * 20 + 35);
  });

  test('short digit runs and letters are not packed', () => {
    expect(code128AutoSymbols('ABC')).toBe(3);
    expect(code128AutoSymbols('AB123')).toBe(5);
    // letters, then 8 digits at the end: 4 symbols plus the switch
    expect(code128AutoSymbols('AB12345678')).toBe(2 + 4 + 1);
  });
});
