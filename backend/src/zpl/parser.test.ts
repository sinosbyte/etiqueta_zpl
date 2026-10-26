import { parseZpl } from './parser';
import { generateZpl } from './generator';
import { GenerateRequest } from './types';

// ── Round-trip tests (generator → parser) ────────────────────────────────────

test('parses label dimensions', () => {
  const result = parseZpl('^XA\n^PW800\n^LL1200\n^XZ');
  expect(result.labelWidth).toBe(800);
  expect(result.labelHeight).toBe(1200);
});

test('round-trips a text element', () => {
  const req: GenerateRequest = {
    labelWidth: 800, labelHeight: 1200,
    elements: [{ id: 'a', type: 'text', x: 80, y: 80, width: 200, height: 40, value: 'Hello', fontSize: 34, fontName: '0' }],
  };
  const zpl = generateZpl(req);
  const result = parseZpl(zpl);
  expect(result.elements).toHaveLength(1);
  const el = result.elements[0];
  expect(el.type).toBe('text');
  expect(el.x).toBe(80);
  expect(el.y).toBe(80);
  expect(el.value).toBe('Hello');
  expect(el.fontSize).toBe(34);
});

test('round-trips a barcode128 element', () => {
  const req: GenerateRequest = {
    labelWidth: 800, labelHeight: 1200,
    elements: [{ id: 'b', type: 'barcode128', x: 100, y: 100, width: 300, height: 100, value: '12345' }],
  };
  const result = parseZpl(generateZpl(req));
  expect(result.elements[0].type).toBe('barcode128');
  expect(result.elements[0].value).toBe('12345');
  expect(result.elements[0].height).toBe(100);
});

test('round-trips a qrcode element', () => {
  const req: GenerateRequest = {
    labelWidth: 800, labelHeight: 1200,
    elements: [{ id: 'c', type: 'qrcode', x: 50, y: 50, width: 100, height: 100, value: 'https://example.com' }],
  };
  const result = parseZpl(generateZpl(req));
  expect(result.elements[0].type).toBe('qrcode');
  expect(result.elements[0].value).toBe('https://example.com');
  // Size must be stable after round-trip — generator uses floor(width/33), parser must use mag*33
  expect(result.elements[0].width).toBe(result.elements[0].height);
  const mag = Math.floor(100 / 33); // 3
  expect(result.elements[0].width).toBe(mag * 33); // 99
});

test('round-trips a rect element', () => {
  const req: GenerateRequest = {
    labelWidth: 800, labelHeight: 1200,
    elements: [{ id: 'd', type: 'rect', x: 10, y: 10, width: 200, height: 150 }],
  };
  const result = parseZpl(generateZpl(req));
  expect(result.elements[0].type).toBe('rect');
  expect(result.elements[0].width).toBe(200);
  expect(result.elements[0].height).toBe(150);
});

test('collects unknown commands without crashing and keeps them as raw ZPL', () => {
  const result = parseZpl('^XA\n^PW800\n^LL1200\n^ZZ99^FS\n^XZ');
  expect(result.unknownCommands.length).toBeGreaterThan(0);
  expect(result.elements).toEqual([expect.objectContaining({ type: 'raw', value: '^ZZ99' })]);
});

// ── New parser capabilities ───────────────────────────────────────────────────

test('parses ^CF default font then plain ^FO^FD^FS text', () => {
  const zpl = '^XA\n^PW800\n^LL600\n^CF0,60\n^FO50,50^FDHello World^FS\n^XZ';
  const result = parseZpl(zpl);
  expect(result.elements).toHaveLength(1);
  const el = result.elements[0];
  expect(el.type).toBe('text');
  expect(el.value).toBe('Hello World');
  expect(el.fontSize).toBe(60);
  expect(el.x).toBe(50);
  expect(el.y).toBe(50);
});

test('field ^A font overrides ^CF default', () => {
  const zpl = '^XA\n^CF0,30\n^FO10,10^A0N,80,80^FDOverride^FS\n^XZ';
  const result = parseZpl(zpl);
  expect(result.elements[0].fontSize).toBe(80);
});

test('parses ^BC barcode with no parameters (uses ^BY height)', () => {
  const zpl = '^XA\n^BY5,2,270\n^FO100,550^BC^FD12345678^FS\n^XZ';
  const result = parseZpl(zpl);
  // The standalone ^BY is also kept verbatim (raw barcodes may depend on it)
  expect(result.elements).toHaveLength(2);
  expect(result.elements[0]).toMatchObject({ type: 'raw', value: '^BY5,2,270' });
  expect(result.elements[1].type).toBe('barcode128');
  expect(result.elements[1].value).toBe('12345678');
  expect(result.elements[1].height).toBe(270);
});

test('parses ^GB as line when one dimension equals thickness', () => {
  // ^GB700,3,3 — height == thickness → line
  const zpl = '^XA\n^FO50,250^GB700,3,3^FS\n^XZ';
  const result = parseZpl(zpl);
  expect(result.elements[0].type).toBe('line');
  expect(result.elements[0].width).toBe(700);
});

test('parses ^GB as rect when thickness is small relative to size', () => {
  // ^GB150,150,3 — thickness < min(w,h) → rect border
  const zpl = '^XA\n^FO600,300^GB150,150,3^FS\n^XZ';
  const result = parseZpl(zpl);
  expect(result.elements[0].type).toBe('rect');
});

test('parses ^GB as solid rect when thickness >= min dimension', () => {
  // ^GB100,100,100 — thickness == min(w,h) → filled rect
  const zpl = '^XA\n^FO50,50^GB100,100,100^FS\n^XZ';
  const result = parseZpl(zpl);
  expect(result.elements[0].type).toBe('rect');
});

test('parses ^FR as reversed on a text element', () => {
  const zpl = '^XA\n^CF0,30\n^FO50,50^FR^FDReversed^FS\n^XZ';
  const result = parseZpl(zpl);
  expect(result.elements[0].reversed).toBe(true);
});

test('preserves ^FX comment lines as comment elements', () => {
  const zpl = '^XA\n^PW400\n^LL400\n^FX This is a comment\n^XZ';
  const result = parseZpl(zpl);
  expect(result.elements).toHaveLength(1);
  expect(result.elements[0].type).toBe('comment');
  expect(result.labelWidth).toBe(400);
});

test('parses ^FX as a comment element', () => {
  const zpl = '^XA\n^PW800\n^LL600\n^FX Top section with logo\n^XZ';
  const result = parseZpl(zpl);
  expect(result.elements).toHaveLength(1);
  expect(result.elements[0].type).toBe('comment');
  expect(result.elements[0].value).toBe('Top section with logo');
});

test('generator emits ^FX for comment elements', () => {
  const zpl = generateZpl({
    labelWidth: 800, labelHeight: 600,
    elements: [{ id: 'c1', type: 'comment', x: 0, y: 0, width: 0, height: 0, value: 'My comment' }],
  });
  expect(zpl).toContain('^FX My comment');
});

test('round-trip preserves ^FX comments in position', () => {
  const original = '^XA\n^PW800\n^LL600\n^FX Top section\n^CF0,30\n^FO50,50^FDHello^FS\n^XZ';
  const parsed = parseZpl(original);
  const regenerated = generateZpl({ labelWidth: 800, labelHeight: 600, elements: parsed.elements });
  expect(regenerated).toContain('^FX Top section');
  expect(regenerated).toContain('^FDHello^FS');
});

it('preserves rect border thickness through parse', () => {
  const result = parseZpl('^XA^PW800^LL1200^FO10,10^GB200,100,4^FS^XZ');
  expect(result.elements).toHaveLength(1);
  expect(result.elements[0].type).toBe('rect');
  expect(result.elements[0].thickness).toBe(4);
});

it('preserves line thickness through parse', () => {
  const result = parseZpl('^XA^PW800^LL1200^FO10,10^GB200,4,4^FS^XZ');
  expect(result.elements).toHaveLength(1);
  expect(result.elements[0].type).toBe('line');
  expect(result.elements[0].thickness).toBe(4);
});

it('does not set thickness on filled rect', () => {
  const result = parseZpl('^XA^PW800^LL1200^FO10,10^GB100,100,100^FS^XZ');
  expect(result.elements[0].type).toBe('rect');
  expect(result.elements[0].filled).toBe(true);
  expect(result.elements[0].thickness).toBeUndefined();
});

test('parses the full labelary sample label', () => {
  const zpl = `^XA
^FX Top section.
^CF0,60
^FO50,50^GB100,100,100^FS
^FO75,75^FR^GB100,100,100^FS
^FO93,93^GB40,40^FS
^FO220,50^FDIntershipping, Inc.^FS
^CF0,30
^FO220,115^FD1000 Shipping Lane^FS
^FO220,155^FDShelbyville TN 38102^FS
^FO220,195^FDUnited States (USA)^FS
^FO50,250^GB700,3,3^FS
^FX Second section.
^FO50,300^FDJohn Doe^FS
^FO50,340^FD100 Main Street^FS
^FO50,380^FDSpringfield TN 39021^FS
^FO50,420^FDUnited States (USA)^FS
^CFA,15
^FO600,300^GB150,150,3^FS
^FO638,340^FDPermit^FS
^FO638,390^FD123456^FS
^FO50,500^GB700,3,3^FS
^FX Third section.
^BY5,2,270
^FO100,550^BC^FD12345678^FS
^FX Fourth section.
^FO50,900^GB700,250,3^FS
^FO400,900^GB3,250,3^FS
^CF0,40
^FO100,960^FDCtr. X34B-1^FS
^FO100,1010^FDREF1 F00B47^FS
^FO100,1060^FDREF2 BL4H8^FS
^CF0,190
^FO470,955^FDCA^FS
^XZ`;
  const result = parseZpl(zpl);
  // Should produce text, rect, line, and barcode elements — not zero
  expect(result.elements.length).toBeGreaterThan(5);
  const types = result.elements.map(e => e.type);
  expect(types).toContain('text');
  expect(types).toContain('barcode128');
  // At least one line (the separator rules)
  expect(types).toContain('line');
});

// ── Dynamic placeholder parsing ────────────────────────────────────────────────

test('parses {{name}} text field as a dynamic element', () => {
  const zpl = '^XA\n^CF0,30\n^FO50,50^FD{{company}}^FS\n^XZ';
  const el = parseZpl(zpl).elements[0];
  expect(el.type).toBe('text');
  expect(el.dynamic).toBe(true);
  expect(el.variableName).toBe('company');
});

test('parses {{name}} barcode field as dynamic', () => {
  const zpl = '^XA\n^FO100,550^BC^FD{{sku}}^FS\n^XZ';
  const el = parseZpl(zpl).elements[0];
  expect(el.type).toBe('barcode128');
  expect(el.dynamic).toBe(true);
  expect(el.variableName).toBe('sku');
});

test('parses {{name}} qrcode field as dynamic', () => {
  const zpl = '^XA\n^FO50,50^BQN,2,3^FDMA,{{url}}^FS\n^XZ';
  const el = parseZpl(zpl).elements[0];
  expect(el.type).toBe('qrcode');
  expect(el.dynamic).toBe(true);
  expect(el.variableName).toBe('url');
});

test('does not mark a normal field as dynamic', () => {
  const el = parseZpl('^XA\n^CF0,30\n^FO50,50^FDHello^FS\n^XZ').elements[0];
  expect(el.dynamic).toBeUndefined();
});

test('round-trips a dynamic text element', () => {
  const req: GenerateRequest = {
    labelWidth: 800, labelHeight: 1200,
    elements: [{ id: 'a', type: 'text', x: 80, y: 80, width: 200, height: 40, fontSize: 34, fontName: '0', dynamic: true, variableName: 'company' }],
  };
  const el = parseZpl(generateZpl(req)).elements[0];
  expect(el.dynamic).toBe(true);
  expect(el.variableName).toBe('company');
});

// ── Preserving ZPL the canvas cannot represent ────────────────────────────────

// Real client label (Atlas "Contém"): ^FT, ^FB, Interleaved 2 of 5 (^B2),
// ^MMT/^LS/^CI, font widths and rounded boxes.
const ATLAS_LABEL = `^XA
^CI28
^MMT
^PW812
^LL0551
^LS0
^FX MARCA
^FT180,70^A0N,65,55^FD{{MARCA}}^FS
^FT220,145^A0N,34,30^FB120,1,0,R,0^FDREF.:^FS
^FT330,145^A0N,75,50^FB470,1,0,C,0^FD{{REFERENCIA}}^FS
^FO160,165^GB300,145,2,B,2^FS
^FO170,185^A0N,34,24^FDCONTÉM: {{QTD}} PEÇAS^FS
^FO160,320^GB300,50,2,B,4^FS
^FO170,333^A0N,31,26^FDVALIDADE {{VALIDADE}}^FS
^FO480,265^GB315,3,2^FS
^FT180,410^A0N,24,17^FDATLAS S/A AV. INDEPENDENCIA 8885^FS
^BY3,3,130
^FO20,50^B2B,100,Y,N,N^FD{{EAN}}^FS
^XZ`;

test('regenerates the Atlas label with every field and command intact', () => {
  const parsed = parseZpl(ATLAS_LABEL);
  const zpl = generateZpl({ labelWidth: parsed.labelWidth, labelHeight: parsed.labelHeight, elements: parsed.elements });

  for (const fragment of [
    '^CI28',
    '^MMT',
    '^LS0',
    '^FT180,70^A0N,65,55^FD{{MARCA}}^FS',
    '^FT220,145^A0N,34,30^FB120,1,0,R,0^FDREF.:^FS',
    '^FT330,145^A0N,75,50^FB470,1,0,C,0^FD{{REFERENCIA}}^FS',
    '^FT180,410^A0N,24,17^FDATLAS S/A AV. INDEPENDENCIA 8885^FS',
    '^BY3,3,130',
    // Interleaved 2 of 5 is now editable: regenerated with its ^BY inline (same print)
    '^FO20,50^BY3,3^B2B,100,Y,N,N^FD{{EAN}}^FS',
  ]) {
    expect(zpl).toContain(fragment);
  }
  expect(parsed.labelWidth).toBe(812);
  expect(parsed.labelHeight).toBe(551);
});

test('keeps supported fields editable, with font width and box rounding (Atlas label)', () => {
  const parsed = parseZpl(ATLAS_LABEL);
  const text = parsed.elements.find(e => e.type === 'text' && e.value === 'CONTÉM: {{QTD}} PEÇAS');
  expect(text).toMatchObject({ x: 170, y: 185, fontSize: 34, fontWidth: 24 });

  const box = parsed.elements.find(e => e.type === 'rect' && e.x === 160 && e.y === 165);
  expect(box).toMatchObject({ width: 300, height: 145, thickness: 2, rounding: 2 });

  const zpl = generateZpl({ labelWidth: 812, labelHeight: 551, elements: parsed.elements });
  expect(zpl).toContain('^FO170,185^A0N,34,24^FDCONTÉM: {{QTD}} PEÇAS^FS');
  expect(zpl).toContain('^FO160,165^GB300,145,2,B,2^FS');
  expect(zpl).toContain('^FO160,320^GB300,50,2,B,4^FS');
  expect(zpl).toContain('^FO480,265^GB315,3,2^FS');
});

test('regenerating twice gives the same ZPL (stable round-trip)', () => {
  const first = parseZpl(ATLAS_LABEL);
  const zpl1 = generateZpl({ labelWidth: first.labelWidth, labelHeight: first.labelHeight, elements: first.elements });
  const second = parseZpl(zpl1);
  const zpl2 = generateZpl({ labelWidth: second.labelWidth, labelHeight: second.labelHeight, elements: second.elements });
  expect(zpl2).toBe(zpl1);
});

test('keeps ~ commands and ^FH fields verbatim (HU label style)', () => {
  const zpl = String.raw`^XA
~TA000
~SD15
^PW799
^FT29,86^A0N,76,86^FH\^CI28^FDABC-123^FS^CI27
^PQ1,0,1,Y
^XZ`;
  const parsed = parseZpl(zpl);
  const out = generateZpl({ labelWidth: parsed.labelWidth, labelHeight: parsed.labelHeight, elements: parsed.elements });
  for (const fragment of ['~TA000', '~SD15', String.raw`^FT29,86^A0N,76,86^FH\^CI28^FDABC-123^FS`, '^CI27', '^PQ1,0,1,Y']) {
    expect(out).toContain(fragment);
  }
});

test('keeps a rotated text field as raw ZPL', () => {
  const parsed = parseZpl('^XA\n^FO10,10^A0R,30,30^FDRotated^FS\n^XZ');
  expect(parsed.elements).toEqual([expect.objectContaining({ type: 'raw', value: '^FO10,10^A0R,30,30^FDRotated^FS' })]);
});

test('keeps a Code 128 with non-default options as raw ZPL', () => {
  const parsed = parseZpl('^XA\n^FO10,10^BCN,100,N,N,N^FD123^FS\n^XZ');
  expect(parsed.elements[0]).toMatchObject({ type: 'raw', value: '^FO10,10^BCN,100,N,N,N^FD123^FS' });
});

test('keeps a QR code with manual input mode as raw ZPL', () => {
  const parsed = parseZpl('^XA\n^FO10,10^BQN,2,4^FDMM,Ahttps://example.com^FS\n^XZ');
  expect(parsed.elements[0]).toMatchObject({ type: 'raw', value: '^FO10,10^BQN,2,4^FDMM,Ahttps://example.com^FS' });
});

test('parses QR error correction level and keeps it on regenerate', () => {
  const parsed = parseZpl('^XA\n^FO10,10^BQN,2,4^FDQA,https://example.com^FS\n^XZ');
  expect(parsed.elements[0]).toMatchObject({ type: 'qrcode', value: 'https://example.com', qrErrorCorrection: 'Q' });
  expect(generateZpl({ labelWidth: 800, labelHeight: 400, elements: parsed.elements })).toContain('^FDQA,https://example.com^FS');
});

test('keeps a field without ^FS as raw ZPL', () => {
  const parsed = parseZpl('^XA\n^FO10,10^A0N,30,30^FDOpen field\n^XZ');
  expect(parsed.elements[0]).toMatchObject({ type: 'raw', value: '^FO10,10^A0N,30,30^FDOpen field' });
});

// ── ^FT, ^FB and Interleaved 2 of 5 on the canvas ─────────────────────────────

test('parses a ^FT text field as editable, top-left on the canvas', () => {
  const parsed = parseZpl('^XA\n^FT180,70^A0N,65,55^FD{{MARCA}}^FS\n^XZ');
  expect(parsed.elements).toEqual([expect.objectContaining({
    type: 'text', origin: 'FT', x: 180, y: 5, fontSize: 65, fontWidth: 55, dynamic: true, variableName: 'MARCA',
  })]);
});

test('parses a ^FB text field as an aligned block', () => {
  const parsed = parseZpl(String.raw`^XA
^FO500,230^A0N,35,29^FB305,1,0,C,0^FD{{LOTE}}\&^FS
^XZ`);
  expect(parsed.elements[0]).toMatchObject({
    type: 'text', x: 500, y: 230, width: 305, height: 35, value: String.raw`{{LOTE}}\&`,
    block: { maxLines: 1, lineSpacing: 0, justify: 'C', hangingIndent: 0 },
  });
});

test('regenerates ^FT and ^FB fields exactly as written', () => {
  const zpl = String.raw`^XA
^FT220,145^A0N,34,30^FB120,1,0,R,0^FDREF.:\&^FS
^FT330,145^A0N,75,50^FB470,1,0,C,0^FD{{REFERENCIA}}\&^FS
^FO480,280^A0N,25,20^FB325,2,4,J,10^FDDATA:\&^FS
^XZ`;
  const parsed = parseZpl(zpl);
  expect(parsed.elements.every(e => e.type === 'text')).toBe(true);
  const out = generateZpl({ labelWidth: 812, labelHeight: 551, elements: parsed.elements });
  expect(out).toContain(String.raw`^FT220,145^A0N,34,30^FB120,1,0,R,0^FDREF.:\&^FS`);
  expect(out).toContain(String.raw`^FT330,145^A0N,75,50^FB470,1,0,C,0^FD{{REFERENCIA}}\&^FS`);
  expect(out).toContain(String.raw`^FO480,280^A0N,25,20^FB325,2,4,J,10^FDDATA:\&^FS`);
});

test('moving and resizing a ^FT/^FB field keeps ^FT and resizes the block', () => {
  const parsed = parseZpl('^XA\n^FT330,145^A0N,75,50^FB470,1,0,C,0^FDREF^FS\n^XZ');
  const el = { ...parsed.elements[0], x: 300, y: 100, width: 500 };
  const out = generateZpl({ labelWidth: 812, labelHeight: 551, elements: [el] });
  // baseline = new top (100) + font height (75)
  expect(out).toContain('^FT300,175^A0N,75,50^FB500,1,0,C,0^FDREF^FS');
});

test('parses Interleaved 2 of 5 (^B2) with ^BY settings and vertical orientation', () => {
  const parsed = parseZpl('^XA\n^BY3,3,130\n^FO20,50^B2B,100,Y,N,N^FD{{EAN}}^FS\n^XZ');
  const bc = parsed.elements.find(e => e.type === 'barcodeI2of5');
  // GTIN-14 placeholder: 14 digits x (3 + 2*3) + 6 + 3 = 135 modules x 3 dots = 405
  expect(bc).toMatchObject({
    x: 20, y: 50, width: 100, height: 405, orientation: 'B', moduleWidth: 3, ratio: 3,
    dynamic: true, variableName: 'EAN',
  });
  expect(bc?.printLine).toBeUndefined();  // default Y
});

test('regenerates Interleaved 2 of 5 in every orientation', () => {
  for (const o of ['N', 'R', 'I', 'B']) {
    const zpl = `^XA\n^FO10,10^BY2,2.5^B2${o},80,N,Y,Y^FD12345678^FS\n^XZ`;
    const parsed = parseZpl(zpl);
    expect(parsed.elements[0].type).toBe('barcodeI2of5');
    expect(generateZpl({ labelWidth: 800, labelHeight: 400, elements: parsed.elements }))
      .toContain(`^FO10,10^BY2,2.5^B2${o},80,N,Y,Y^FD12345678^FS`);
  }
});

test('keeps ^FT/^FB barcodes and boxes as raw ZPL', () => {
  const parsed = parseZpl('^XA\n^FT10,100^BCN,80,Y,N,N^FD123^FS\n^FO10,10^FB200,1,0,C,0^GB100,50,2^FS\n^XZ');
  expect(parsed.elements.map(e => e.type)).toEqual(['raw', 'raw']);
});

test('keeps ^FO with justification and other barcodes (^B3) as raw ZPL', () => {
  const parsed = parseZpl('^XA\n^FO10,10,1^A0N,30,30^FDRight^FS\n^FO10,100^B3N,N,80,Y,N^FDABC^FS\n^XZ');
  expect(parsed.elements.map(e => e.type)).toEqual(['raw', 'raw']);
});
