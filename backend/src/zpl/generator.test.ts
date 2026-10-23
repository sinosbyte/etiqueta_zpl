import { generateZpl } from './generator';
import { GenerateRequest } from './types';

const base: GenerateRequest = { labelWidth: 800, labelHeight: 1200, elements: [] };

test('wraps output in ^XA / ^XZ', () => {
  const zpl = generateZpl(base);
  expect(zpl).toMatch(/^\^XA/);
  expect(zpl).toMatch(/\^XZ$/);
});

test('sets label dimensions', () => {
  const zpl = generateZpl(base);
  expect(zpl).toContain('^PW800');
  expect(zpl).toContain('^LL1200');
});

test('generates text element', () => {
  const zpl = generateZpl({
    ...base,
    elements: [{ id: '1', type: 'text', x: 80, y: 80, width: 200, height: 40, value: 'Hello', fontSize: 34, fontName: '0' }],
  });
  expect(zpl).toContain('^FO80,80');
  expect(zpl).toContain('^A0N,34,34');
  expect(zpl).toContain('^FDHello^FS');
});

test('generates barcode128 element', () => {
  const zpl = generateZpl({
    ...base,
    elements: [{ id: '2', type: 'barcode128', x: 100, y: 100, width: 300, height: 100, value: '12345' }],
  });
  expect(zpl).toContain('^FO100,100');
  expect(zpl).toContain('^BCN,100,Y,N,N');
  expect(zpl).toContain('^FD12345^FS');
});

test('generates qrcode element', () => {
  const zpl = generateZpl({
    ...base,
    elements: [{ id: '3', type: 'qrcode', x: 50, y: 50, width: 100, height: 100, value: 'https://example.com' }],
  });
  expect(zpl).toContain('^FO50,50');
  expect(zpl).toContain('^BQN,2,');
  expect(zpl).toContain('^FDMA,https://example.com^FS');
});

test('generates rect element', () => {
  const zpl = generateZpl({
    ...base,
    elements: [{ id: '4', type: 'rect', x: 10, y: 10, width: 200, height: 150 }],
  });
  expect(zpl).toContain('^FO10,10');
  expect(zpl).toContain('^GB200,150,8^FS');
});


it('uses element thickness for rect border when provided', () => {
  const result = generateZpl({
    labelWidth: 800, labelHeight: 1200,
    elements: [{ id: '1', type: 'rect', x: 10, y: 10, width: 200, height: 100, thickness: 4 }],
  });
  expect(result).toContain('^GB200,100,4');
});

it('defaults rect border thickness to 8 when not provided', () => {
  const result = generateZpl({
    labelWidth: 800, labelHeight: 1200,
    elements: [{ id: '1', type: 'rect', x: 10, y: 10, width: 200, height: 100 }],
  });
  expect(result).toContain('^GB200,100,8');
});

it('derives line thickness from the shorter dimension, ignoring a stored thickness', () => {
  // Regression: a resized line must not become a hollow box. A stored
  // thickness of 3 on a 200x163 box must NOT emit ^GB200,163,3 (a box).
  const result = generateZpl({
    labelWidth: 800, labelHeight: 1200,
    elements: [{ id: '1', type: 'line', x: 10, y: 10, width: 200, height: 163, thickness: 3 }],
  });
  expect(result).toContain('^GB200,163,163');
  expect(result).not.toContain('^GB200,163,3');
});

it('emits line thickness as min(width, height)', () => {
  const result = generateZpl({
    labelWidth: 800, labelHeight: 1200,
    elements: [{ id: '1', type: 'line', x: 10, y: 10, width: 200, height: 6 }],
  });
  expect(result).toContain('^GB200,6,6');
});

it('emits a vertical line as a solid bar of its width', () => {
  const result = generateZpl({
    labelWidth: 800, labelHeight: 1200,
    elements: [{ id: '1', type: 'line', x: 10, y: 10, width: 4, height: 300 }],
  });
  expect(result).toContain('^GB4,300,4');
});

test('dynamic text emits {{variableName}} placeholder', () => {
  const zpl = generateZpl({
    ...base,
    elements: [{ id: '1', type: 'text', x: 80, y: 80, width: 200, height: 40, value: 'ignored', fontSize: 34, fontName: '0', dynamic: true, variableName: 'company' }],
  });
  expect(zpl).toContain('^FD{{company}}^FS');
  expect(zpl).not.toContain('ignored');
});

test('dynamic barcode128 emits {{variableName}} placeholder', () => {
  const zpl = generateZpl({
    ...base,
    elements: [{ id: '2', type: 'barcode128', x: 100, y: 100, width: 300, height: 100, dynamic: true, variableName: 'sku' }],
  });
  expect(zpl).toContain('^FD{{sku}}^FS');
});

test('dynamic qrcode emits {{variableName}} placeholder', () => {
  const zpl = generateZpl({
    ...base,
    elements: [{ id: '3', type: 'qrcode', x: 50, y: 50, width: 100, height: 100, dynamic: true, variableName: 'url' }],
  });
  expect(zpl).toContain('^FDMA,{{url}}^FS');
});

test('emits raw elements verbatim', () => {
  const zpl = generateZpl({
    ...base,
    elements: [{ id: 'r', type: 'raw', x: 0, y: 0, width: 0, height: 0, value: '^FT10,20^A0N,30,20^FB200,1,0,C,0^FDHi^FS' }],
  });
  expect(zpl).toContain('\n^FT10,20^A0N,30,20^FB200,1,0,C,0^FDHi^FS\n');
});

test('emits font width when it differs from the height', () => {
  const zpl = generateZpl({
    ...base,
    elements: [{ id: 't', type: 'text', x: 10, y: 10, width: 200, height: 40, value: 'Narrow', fontSize: 34, fontWidth: 24, fontName: '0', fontSource: 'a' }],
  });
  expect(zpl).toContain('^FO10,10^A0N,34,24^FDNarrow^FS');
});

test('emits font width in ^CF for default-font text', () => {
  const zpl = generateZpl({
    ...base,
    elements: [{ id: 't', type: 'text', x: 10, y: 10, width: 200, height: 40, value: 'Narrow', fontSize: 30, fontWidth: 20, fontName: '0', fontSource: 'cf' }],
  });
  expect(zpl).toContain('^CF0,30,20');
});

test('emits box color and rounding only when set', () => {
  const zpl = generateZpl({
    ...base,
    elements: [
      { id: 'a', type: 'rect', x: 10, y: 10, width: 300, height: 100, thickness: 2, rounding: 3 },
      { id: 'b', type: 'rect', x: 10, y: 200, width: 300, height: 100, thickness: 2 },
    ],
  });
  expect(zpl).toContain('^FO10,10^GB300,100,2,B,3^FS');
  expect(zpl).toContain('^FO10,200^GB300,100,2^FS');
});

test('emits QR error correction level, defaulting to M', () => {
  const zpl = generateZpl({
    ...base,
    elements: [
      { id: 'q', type: 'qrcode', x: 10, y: 10, width: 132, height: 132, value: 'A', qrErrorCorrection: 'H' },
      { id: 'm', type: 'qrcode', x: 200, y: 10, width: 132, height: 132, value: 'B' },
    ],
  });
  expect(zpl).toContain('^FDHA,A^FS');
  expect(zpl).toContain('^FDMA,B^FS');
});
