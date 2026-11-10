import { parseZpl } from './parser';
import { generateZpl } from './generator';
import { decodeHexUtf8, encodeHexUtf8 } from './hexText';
import { ElementSchema } from './schema';
import { Element } from './types';

// Text as ZebraDesigner writes it: ^FH\ turns on \HH escapes, ^CI28 selects UTF-8 for the
// field and ^CI27 puts the character set back. Every sample here is made up.
const FIELD = '^FT29,86^A0N,76,86^FH\\^CI28^FDEXEMPLO^FS^CI27';
const label = (...lines: string[]) => ['^XA', '^PW799', '^LL504', ...lines, '^XZ'].join('\n');
const roundTrip = (zpl: string) => {
  const parsed = parseZpl(zpl);
  return generateZpl({ elements: parsed.elements as Element[], labelWidth: parsed.labelWidth, labelHeight: parsed.labelHeight });
};
const raws = (zpl: string) => parseZpl(zpl).elements.filter(e => e.type === 'raw').map(e => e.value);

describe('decodeHexUtf8', () => {
  test('plain text is unchanged', () => {
    expect(decodeHexUtf8('EXEMPLO 123 {{VAR}}')).toBe('EXEMPLO 123 {{VAR}}');
  });
  test('UTF-8 bytes written as \\HH become the character', () => {
    expect(decodeHexUtf8('Cal\\C3\\A7ado')).toBe('Calçado');
    expect(decodeHexUtf8('\\E2\\82\\AC 10')).toBe('€ 10');
  });
  test('the escapes of the control characters become those characters', () => {
    expect(decodeHexUtf8('a\\5Cb\\5Ec\\7Ed')).toBe('a\\b^c~d');
  });
  test('lower case hex digits are accepted', () => {
    expect(decodeHexUtf8('Cal\\c3\\a7ado')).toBe('Calçado');
  });
  test('what cannot be read safely gives null: bad escape, cut UTF-8 sequence, lone indicator', () => {
    expect(decodeHexUtf8('a\\ZZb')).toBeNull();
    expect(decodeHexUtf8('a\\C3')).toBeNull();      // first byte of a 2-byte character only
    expect(decodeHexUtf8('a\\E9b')).toBeNull();     // Latin-1 byte, not UTF-8
    expect(decodeHexUtf8('abc\\')).toBeNull();
    expect(decodeHexUtf8('abc\\5')).toBeNull();
  });
});

describe('encodeHexUtf8', () => {
  test('printable ASCII is left as it is, variables included', () => {
    expect(encodeHexUtf8('EXEMPLO 123 {{VAR}} a-b/c')).toBe('EXEMPLO 123 {{VAR}} a-b/c');
  });
  test('non-ASCII characters become UTF-8 \\HH escapes', () => {
    expect(encodeHexUtf8('Calçado')).toBe('Cal\\C3\\A7ado');
    expect(encodeHexUtf8('€')).toBe('\\E2\\82\\AC');
    expect(encodeHexUtf8('😀')).toBe('\\F0\\9F\\98\\80');
  });
  test('the characters that would break the field or the escape are escaped', () => {
    expect(encodeHexUtf8('a\\b^c~d')).toBe('a\\5Cb\\5Ec\\7Ed');
    expect(encodeHexUtf8('a\nb')).toBe('a\\0Ab');
  });
  test('encode then decode gives the text back', () => {
    for (const s of ['', 'EXEMPLO', 'Calçado ação', '{{DESCRICAO}} 10€', 'a\\b^c~d', 'linha\nquebrada', '😀 ok']) {
      expect(decodeHexUtf8(encodeHexUtf8(s))).toBe(s);
    }
  });
});

describe('parsing text written with ^FH\\^CI28 ... ^FS^CI27', () => {
  test('becomes one editable text element; the ^CI27 that follows the field is not a separate block', () => {
    const { elements, labelHeight } = parseZpl(label(FIELD));
    expect(labelHeight).toBe(504);
    expect(elements).toHaveLength(1);
    expect(elements[0]).toMatchObject({
      type: 'text', value: 'EXEMPLO', hexUtf8: true, origin: 'FT',
      fontSize: 76, fontWidth: 86, fontName: '0', x: 29, y: 86 - 76,
    });
  });

  test('accents written as \\HH are shown as text', () => {
    const { elements } = parseZpl(label('^FO10,20^A0N,30,30^FH\\^CI28^FDCal\\C3\\A7ado^FS^CI27'));
    expect(elements).toHaveLength(1);
    expect(elements[0]).toMatchObject({ type: 'text', value: 'Calçado', hexUtf8: true });
  });

  test('a field that is only {{VARIABLE}} is a dynamic variable', () => {
    const { elements } = parseZpl(label('^FT29,130^A0N,31,25^FH\\^CI28^FD{{MATERIAL}}^FS^CI27'));
    expect(elements[0]).toMatchObject({ type: 'text', hexUtf8: true, dynamic: true, variableName: 'MATERIAL' });
  });

  test('works with a ^FB text block', () => {
    const { elements } = parseZpl(label('^FO30,40^A0N,30,30^FB300,2,0,C,0^FH\\^CI28^FDabc^FS^CI27'));
    expect(elements).toHaveLength(1);
    expect(elements[0]).toMatchObject({ type: 'text', hexUtf8: true, width: 300 });
    expect(elements[0].block).toMatchObject({ maxLines: 2, justify: 'C' });
  });

  test('label-level ^CI27 and printer settings are kept as before', () => {
    const zpl = label('^MMT', '^LS0', '^CI27', FIELD, '^PQ1,0,1,Y');
    expect(raws(zpl)).toEqual(['^MMT', '^LS0', '^CI27', '^PQ1,0,1,Y']);
    expect(parseZpl(zpl).elements.filter(e => e.type === 'text')).toHaveLength(1);
  });

  test('several fields in a row each take their own ^CI27', () => {
    const zpl = label(
      '^FT29,86^A0N,76,86^FH\\^CI28^FDUM^FS^CI27',
      '^FT29,130^A0N,31,25^FH\\^CI28^FDDOIS^FS^CI27',
      '^FT29,205^A0N,38,53^FH\\^CI28^FDTRES^FS^CI27',
    );
    const { elements } = parseZpl(zpl);
    expect(elements.map(e => e.type)).toEqual(['text', 'text', 'text']);
    expect(elements.map(e => e.value)).toEqual(['UM', 'DOIS', 'TRES']);
  });
});

describe('regenerating that text', () => {
  test('gives back exactly the field that was read', () => {
    expect(roundTrip(label(FIELD))).toContain(FIELD);
  });

  test('a made-up label with several fields comes back identical, field by field', () => {
    const fields = [
      '^FT215,387^A0N,28,35^FH\\^CI28^FDUC:^FS^CI27',
      '^FT275,387^A0N,28,35^FH\\^CI28^FD{{CODIGO}}^FS^CI27',
      '^FT29,130^A0N,31,25^FH\\^CI28^FD{{DESCRICAO}}^FS^CI27',
      '^FT29,205^A0N,38,53^FH\\^CI28^FDQTD:^FS^CI27',
      '^FT150,205^A0N,38,53^FH\\^CI28^FD{{QTD}}{{UN}}^FS^CI27',
      '^FO0,150^GB795,4,4^FS',
      '^FT29,466^A0N,20,18^FH\\^CI28^FDLOTE:^FS^CI27',
    ];
    const zpl = label('^MMT', '^LS0', '^CI27', ...fields);
    const back = roundTrip(zpl).split('\n');
    for (const f of fields) expect(back).toContain(f);
    // and nothing is left as an uneditable block except the label settings
    expect(raws(zpl)).toEqual(['^MMT', '^LS0', '^CI27']);
  });

  test('accents typed in the editor are written as \\HH, and read back as the same text', () => {
    const el: Element = { id: 'a', type: 'text', x: 10, y: 20, width: 200, height: 40, value: 'Calçado ^ ~ \\', fontSize: 30, fontName: '0', fontSource: 'a', hexUtf8: true };
    const zpl = generateZpl({ labelWidth: 800, labelHeight: 400, elements: [el] });
    expect(zpl).toContain('^FO10,20^A0N,30,30^FH\\^CI28^FDCal\\C3\\A7ado \\5E \\7E \\5C^FS^CI27');
    expect(parseZpl(zpl).elements[0]).toMatchObject({ type: 'text', value: 'Calçado ^ ~ \\', hexUtf8: true });
  });

  test('a text that uses ^CF (no ^A) also gets the wrapper', () => {
    const el: Element = { id: 'a', type: 'text', x: 10, y: 20, width: 200, height: 40, value: 'abc', fontSize: 30, fontName: '0', fontSource: 'cf', hexUtf8: true };
    expect(generateZpl({ labelWidth: 800, labelHeight: 400, elements: [el] })).toContain('^FO10,20^FH\\^CI28^FDabc^FS^CI27');
  });
});

describe('nothing changes for text without the flag', () => {
  const plain: Element = { id: 'a', type: 'text', x: 10, y: 20, width: 200, height: 40, value: 'Calçado', fontSize: 30, fontName: '0', fontSource: 'a' };

  test('the generated ZPL has no ^FH, ^CI or escapes', () => {
    const zpl = generateZpl({ labelWidth: 800, labelHeight: 400, elements: [plain] });
    expect(zpl).toBe('^XA\n^PW800\n^LL400\n^FO10,20^A0N,30,30^FDCalçado^FS\n^XZ');
  });

  test('flag set to false behaves like no flag', () => {
    expect(generateZpl({ labelWidth: 800, labelHeight: 400, elements: [{ ...plain, hexUtf8: false }] }))
      .toBe(generateZpl({ labelWidth: 800, labelHeight: 400, elements: [plain] }));
  });

  test('parsing plain text does not set the flag', () => {
    expect(parseZpl(label('^FO10,20^A0N,30,30^FDabc^FS')).elements[0].hexUtf8).toBeUndefined();
  });
});

describe('anything that is not exactly that format stays raw, byte for byte', () => {
  test('a different indicator character (^FH_)', () => {
    const zpl = label('^FO10,10^A0N,30,30^FH_^CI28^FDabc^FS^CI27');
    expect(parseZpl(zpl).elements.every(e => e.type === 'raw')).toBe(true);
    expect(roundTrip(zpl)).toContain('^FO10,10^A0N,30,30^FH_^CI28^FDabc^FS');
  });

  test('^FH without ^CI28', () => {
    const zpl = label('^FO10,10^A0N,30,30^FH\\^FDabc^FS');
    expect(parseZpl(zpl).elements.every(e => e.type === 'raw')).toBe(true);
    expect(roundTrip(zpl)).toContain('^FO10,10^A0N,30,30^FH\\^FDabc^FS');
  });

  test('^CI28 without ^FH', () => {
    const zpl = label('^FO10,10^A0N,30,30^CI28^FDabc^FS');
    expect(parseZpl(zpl).elements.every(e => e.type === 'raw')).toBe(true);
  });

  test('no ^CI27 right after the field', () => {
    const zpl = label('^FO10,10^A0N,30,30^FH\\^CI28^FDabc^FS', '^FO10,60^A0N,30,30^FDdef^FS');
    const els = parseZpl(zpl).elements;
    expect(els[0].type).toBe('raw');
    expect(els[1]).toMatchObject({ type: 'text', value: 'def' });
    expect(els[1].hexUtf8).toBeUndefined();
    expect(roundTrip(zpl)).toContain('^FO10,10^A0N,30,30^FH\\^CI28^FDabc^FS');
  });

  test('a different character set after the field (^CI28)', () => {
    const zpl = label('^FO10,10^A0N,30,30^FH\\^CI28^FDabc^FS^CI28');
    expect(parseZpl(zpl).elements.every(e => e.type === 'raw')).toBe(true);
  });

  test('data that is not valid UTF-8 escapes', () => {
    const zpl = label('^FO10,10^A0N,30,30^FH\\^CI28^FDa\\C3^FS^CI27');
    expect(parseZpl(zpl).elements.every(e => e.type === 'raw')).toBe(true);
    expect(roundTrip(zpl)).toContain('^FDa\\C3^FS');
  });

  test('empty data', () => {
    const zpl = label('^FO10,10^A0N,30,30^FH\\^CI28^FD^FS^CI27');
    expect(parseZpl(zpl).elements.every(e => e.type === 'raw')).toBe(true);
  });

  test('a barcode with ^FH is not turned into anything', () => {
    const zpl = label('^FO10,10^BY2^BCN,80,Y,N,N^FH\\^CI28^FD123^FS^CI27');
    expect(parseZpl(zpl).elements.some(e => e.type === 'barcode128')).toBe(false);
    expect(roundTrip(zpl)).toContain('^FH\\^CI28^FD123^FS');
  });

  test('a QR code with ^FH is not turned into anything', () => {
    const zpl = label('^FT550,475^BQN,2,9^FH\\^FDLA,ABC123^FS');
    expect(parseZpl(zpl).elements.some(e => e.type === 'qrcode')).toBe(false);
    expect(roundTrip(zpl)).toContain('^FT550,475^BQN,2,9^FH\\^FDLA,ABC123^FS');
  });

  test('a field with no ^FO/^FT of its own (the position would silently become 0,0)', () => {
    const zpl = label('^A0N,30,30^FH\^CI28^FDabc^FS^CI27');
    expect(parseZpl(zpl).elements.some(e => e.type === 'text')).toBe(false);
    expect(roundTrip(zpl)).toContain('^A0N,30,30^FH\^CI28^FDabc^FS');
  });

  test('a ^FO that comes after the font (not how ZebraDesigner writes it)', () => {
    const zpl = label('^A0N,30,30^FO10,10^FH\^CI28^FDabc^FS^CI27');
    expect(parseZpl(zpl).elements.some(e => e.type === 'text')).toBe(false);
  });

  test('rotated text placed with ^FT', () => {
    const zpl = label('^FT100,200^A0R,30,30^FH\\^CI28^FDabc^FS^CI27');
    expect(parseZpl(zpl).elements.some(e => e.type === 'text')).toBe(false);
  });
});

describe('the flag survives the API schema', () => {
  test('hexUtf8 is accepted and kept', () => {
    const el = { id: 'a', type: 'text', x: 1, y: 2, width: 3, height: 4, value: 'x', hexUtf8: true };
    expect(ElementSchema.parse(el).hexUtf8).toBe(true);
  });
  test('and it is optional', () => {
    const el = { id: 'a', type: 'text', x: 1, y: 2, width: 3, height: 4 };
    expect(ElementSchema.parse(el).hexUtf8).toBeUndefined();
  });
});
