import { generateZpl } from './generator';
import { parseZpl } from './parser';
import { ElementSchema } from './schema';
import { GenerateRequest } from './types';

const label = (el: Record<string, unknown>): GenerateRequest => ({
  labelWidth: 800,
  labelHeight: 600,
  elements: [{ id: 'q', type: 'qrcode', x: 40, y: 60, width: 165, height: 165, value: 'ABC123', ...el } as never],
});

describe('QR code magnification (qrMagnification)', () => {
  test('without the field the magnification still comes from the box width / 33', () => {
    expect(generateZpl(label({ width: 165 }))).toContain('^FO40,60^BQN,2,5^FDMA,ABC123^FS');
    expect(generateZpl(label({ width: 100 }))).toContain('^BQN,2,3^FD');
    expect(generateZpl(label({ width: 1 }))).toContain('^BQN,2,1^FD');       // never below 1
    expect(generateZpl(label({ width: 500 }))).toContain('^BQN,2,10^FD');    // never above 10
  });

  test('with the field it wins over the box width', () => {
    expect(generateZpl(label({ width: 66, qrMagnification: 7 }))).toContain('^BQN,2,7^FDMA,ABC123^FS');
    expect(generateZpl(label({ width: 500, qrMagnification: 2 }))).toContain('^BQN,2,2^FD');
  });

  test('the whole range 1 to 10 is written as is', () => {
    for (let mag = 1; mag <= 10; mag++) {
      expect(generateZpl(label({ qrMagnification: mag }))).toContain(`^BQN,2,${mag}^FD`);
    }
  });

  test('a value outside 1 to 10 is held to the range (the schema refuses it before this)', () => {
    expect(generateZpl(label({ qrMagnification: 0 }))).toContain('^BQN,2,1^FD');
    expect(generateZpl(label({ qrMagnification: 15 }))).toContain('^BQN,2,10^FD');
  });

  test('error correction, variables and reverse keep working with it', () => {
    const zpl = generateZpl(label({ qrMagnification: 4, qrErrorCorrection: 'H', dynamic: true, variableName: 'UC', reversed: true }));
    expect(zpl).toContain('^FO40,60^FR^BQN,2,4^FDHA,{{UC}}^FS');
  });

  test('the parser still reads the magnification into the box (no new field on import)', () => {
    const parsed = parseZpl('^XA\n^FO40,60^BQN,2,5^FDMA,ABC123^FS\n^XZ');
    expect(parsed.elements).toHaveLength(1);
    expect(parsed.elements[0]).toMatchObject({ type: 'qrcode', width: 165, height: 165, value: 'ABC123' });
    expect(parsed.elements[0].qrMagnification).toBeUndefined();
    // ... and writes the same ZPL back
    expect(generateZpl({ labelWidth: parsed.labelWidth, labelHeight: parsed.labelHeight, elements: parsed.elements }))
      .toContain('^BQN,2,5^FDMA,ABC123^FS');
  });

  test('a QR code with the field survives the round trip with the same magnification', () => {
    const zpl = generateZpl(label({ width: 66, height: 66, qrMagnification: 6 }));
    const parsed = parseZpl(zpl);
    expect(generateZpl({ labelWidth: parsed.labelWidth, labelHeight: parsed.labelHeight, elements: parsed.elements }))
      .toContain('^BQN,2,6^FD');
  });
});

describe('qrMagnification in the element schema', () => {
  const base = { id: 'q', type: 'qrcode', x: 0, y: 0, width: 100, height: 100 };

  test('is optional: elements saved before it are still valid and unchanged', () => {
    const parsed = ElementSchema.parse(base);
    expect(parsed).toEqual(base);
    expect('qrMagnification' in parsed).toBe(false);
  });

  test('keeps whole numbers from 1 to 10 (a field the schema does not know is dropped on save)', () => {
    for (const n of [1, 5, 10]) expect(ElementSchema.parse({ ...base, qrMagnification: n }).qrMagnification).toBe(n);
  });

  test('refuses 0, 11, decimals and text', () => {
    for (const bad of [0, 11, -1, 2.5, '5']) {
      expect(ElementSchema.safeParse({ ...base, qrMagnification: bad }).success).toBe(false);
    }
  });
});
