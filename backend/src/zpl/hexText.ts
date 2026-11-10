// Text written with ^FH\ + ^CI28 (how ZebraDesigner writes every text field): ^FH makes the
// printer read \HH as a byte, and ^CI28 reads those bytes as UTF-8. So "ç" travels as \C3\A7.
// These two functions turn that data into plain text for the editor and back.

const HEX_ESCAPE = /^[0-9A-Fa-f]{2}$/;
const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');

/**
 * The text a ^FD with \HH escapes stands for, or null when it cannot be read safely
 * (an escape that is not two hex digits, or bytes that are not valid UTF-8). The caller keeps
 * such a field as raw ZPL, so nothing is ever guessed.
 */
export function decodeHexUtf8(data: string): string | null {
  let out = '';
  let i = 0;
  while (i < data.length) {
    if (data[i] !== '\\') {
      out += data[i];
      i += 1;
      continue;
    }
    // A run of consecutive escapes is one UTF-8 byte sequence
    const bytes: number[] = [];
    while (i < data.length && data[i] === '\\') {
      const pair = data.slice(i + 1, i + 3);
      if (!HEX_ESCAPE.test(pair)) return null;
      bytes.push(parseInt(pair, 16));
      i += 3;
    }
    try {
      out += new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
    } catch {
      return null;
    }
  }
  return out;
}

/**
 * The ^FD data for this text under ^FH\: printable ASCII as it is; the escape character, the
 * ZPL control characters (^ and ~), control codes and everything outside ASCII as UTF-8 \HH.
 */
export function encodeHexUtf8(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x20 && cp < 0x7f && ch !== '\\' && ch !== '^' && ch !== '~') {
      out += ch;
    } else {
      for (const byte of Buffer.from(ch, 'utf8')) out += `\\${hex2(byte)}`;
    }
  }
  return out;
}
