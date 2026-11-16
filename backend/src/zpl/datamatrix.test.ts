import { generateZpl } from './generator';
import { parseZpl } from './parser';
import { ElementSchema } from './schema';
import { DATAMATRIX_SIZES } from './datamatrix';
import { GenerateRequest } from './types';

const label = (el: Record<string, unknown>): GenerateRequest => ({
  labelWidth: 800,
  labelHeight: 600,
  elements: [{ id: 'd', type: 'datamatrix', x: 40, y: 60, width: 64, height: 64, value: 'ABC123', dmModuleSize: 4, ...el } as never],
});
const zplOf = (body: string) => `^XA\n${body}\n^XZ`;

describe('Data Matrix: generating ZPL', () => {
  test('writes ECC 200 with the module size', () => {
    expect(generateZpl(label({}))).toContain('^FO40,60^BXN,4,200^FDABC123^FS');
    expect(generateZpl(label({ dmModuleSize: 7 }))).toContain('^FO40,60^BXN,7,200^FDABC123^FS');
  });

  test('without a module size it uses 4, and holds it to 1..20', () => {
    expect(generateZpl(label({ dmModuleSize: undefined }))).toContain('^BXN,4,200^FD');
    expect(generateZpl(label({ dmModuleSize: 0 }))).toContain('^BXN,1,200^FD');
    expect(generateZpl(label({ dmModuleSize: 99 }))).toContain('^BXN,20,200^FD');
  });

  test('a symbol size is written as columns and rows, the same number twice', () => {
    expect(generateZpl(label({ dmSize: 24 }))).toContain('^BXN,4,200,24,24^FDABC123^FS');
  });

  test('a symbol size that is not a square ECC 200 size is left out', () => {
    expect(generateZpl(label({ dmSize: 11 }))).toContain('^BXN,4,200^FD');
  });

  test('variables and reverse print work as in the other codes', () => {
    expect(generateZpl(label({ dynamic: true, variableName: 'UC', reversed: true }))).toContain('^FO40,60^FR^BXN,4,200^FD{{UC}}^FS');
  });

  test('the box size on the element does not change the ZPL', () => {
    expect(generateZpl(label({ width: 10, height: 10 }))).toBe(generateZpl(label({ width: 900, height: 900 })));
  });
});

describe('Data Matrix: reading ZPL', () => {
  test('reads what the generator writes as an editable element', () => {
    const parsed = parseZpl(zplOf('^FO40,60^BXN,5,200^FDHELLO^FS'));
    expect(parsed.elements).toHaveLength(1);
    expect(parsed.elements[0]).toMatchObject({ type: 'datamatrix', x: 40, y: 60, value: 'HELLO', dmModuleSize: 5 });
    expect(parsed.elements[0].dmSize).toBeUndefined();
  });

  test('reads a symbol size and a variable', () => {
    const parsed = parseZpl(zplOf('^FO10,20^BXN,3,200,32,32^FD{{UC}}^FS'));
    expect(parsed.elements[0]).toMatchObject({ type: 'datamatrix', dmModuleSize: 3, dmSize: 32, dynamic: true, variableName: 'UC' });
  });

  test('round-trips to the same ZPL', () => {
    for (const body of ['^FO40,60^BXN,5,200^FDHELLO^FS', '^FO10,20^BXN,3,200,32,32^FD{{UC}}^FS', '^FO10,20^FR^BXN,8,200^FDX^FS']) {
      const parsed = parseZpl(zplOf(body));
      expect(generateZpl({ labelWidth: parsed.labelWidth, labelHeight: parsed.labelHeight, elements: parsed.elements })).toContain(body);
    }
  });

  test('the defaults the generator leaves out are read the same (format 6, escape _, aspect 1)', () => {
    const parsed = parseZpl(zplOf('^FO10,20^BXN,4,200,,,6,_,1^FDX^FS'));
    expect(parsed.elements[0]).toMatchObject({ type: 'datamatrix', dmModuleSize: 4 });
  });

  // Each of these has to stay as raw ZPL, exactly as it was written
  const mustStayRaw: Array<[string, string]> = [
    ['turned', '^FO10,20^BXR,5,200^FDX^FS'],
    ['no module size', '^FO10,20^BXN,,200^FDX^FS'],
    ['module size 0', '^FO10,20^BXN,0,200^FDX^FS'],
    ['module size over 20', '^FO10,20^BXN,21,200^FDX^FS'],
    ['module size with a decimal', '^FO10,20^BXN,2.5,200^FDX^FS'],
    ['no quality', '^FO10,20^BXN,5^FDX^FS'],
    ['quality 0', '^FO10,20^BXN,5,0^FDX^FS'],
    ['quality 140', '^FO10,20^BXN,5,140^FDX^FS'],
    ['columns without rows', '^FO10,20^BXN,5,200,24^FDX^FS'],
    ['columns different from rows', '^FO10,20^BXN,5,200,18,8^FDX^FS'],
    ['a size that is not an ECC 200 size', '^FO10,20^BXN,5,200,25,25^FDX^FS'],
    ['format 1', '^FO10,20^BXN,5,200,,,1^FDX^FS'],
    ['another escape character', '^FO10,20^BXN,5,200,,,6,~^FDX^FS'],
    ['rectangular aspect', '^FO10,20^BXN,5,200,,,,,2^FDX^FS'],
    ['placed with ^FT', '^FT10,20^BXN,5,200^FDX^FS'],
    ['inside a ^FB block', '^FO10,20^FB200,1,0,L,0^BXN,5,200^FDX^FS'],
  ];
  test.each(mustStayRaw)('stays raw: %s', (_name, body) => {
    const parsed = parseZpl(zplOf(body));
    expect(parsed.elements).toHaveLength(1);
    expect(parsed.elements[0].type).toBe('raw');
    expect(parsed.elements[0].value).toBe(body);
    // and goes back out untouched
    expect(generateZpl({ labelWidth: parsed.labelWidth, labelHeight: parsed.labelHeight, elements: parsed.elements })).toContain(body);
  });
});

describe('Data Matrix in the element schema', () => {
  const base = { id: 'd', type: 'datamatrix', x: 0, y: 0, width: 64, height: 64 };

  test('is a valid element type and keeps its two fields', () => {
    const parsed = ElementSchema.parse({ ...base, dmModuleSize: 6, dmSize: 24 });
    expect(parsed).toMatchObject({ type: 'datamatrix', dmModuleSize: 6, dmSize: 24 });
  });

  test('both fields are optional', () => {
    expect(ElementSchema.parse(base)).toEqual(base);
  });

  test('every ECC 200 square size is accepted and others are not', () => {
    for (const n of DATAMATRIX_SIZES) expect(ElementSchema.safeParse({ ...base, dmSize: n }).success).toBe(true);
    for (const bad of [0, 9, 11, 25, 146, 24.5, '24']) expect(ElementSchema.safeParse({ ...base, dmSize: bad }).success).toBe(false);
  });

  test('refuses a module size outside 1 to 20', () => {
    for (const bad of [0, 21, -1, 2.5, '5']) expect(ElementSchema.safeParse({ ...base, dmModuleSize: bad }).success).toBe(false);
    for (const good of [1, 4, 20]) expect(ElementSchema.safeParse({ ...base, dmModuleSize: good }).success).toBe(true);
  });
});
