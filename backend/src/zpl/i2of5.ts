// Interleaved 2 of 5 geometry shared by the parser and the generator.

// Digits assumed for a dynamic {{variable}} value: a GTIN-14 is the usual payload.
export const I2OF5_PLACEHOLDER_DIGITS = 14;

/** Number of digits the symbol encodes; non-numeric (dynamic) data uses the placeholder size. */
export const i2of5DigitCount = (value: string): number =>
  /^\d+$/.test(value) ? value.length : I2OF5_PLACEHOLDER_DIGITS;

/**
 * Symbol length in narrow-bar modules. Each digit is 3 narrow + 2 wide
 * elements; the start pattern is 4 narrow and the stop pattern is wide + 2
 * narrow. An odd digit count (after the optional check digit) is padded with a
 * leading zero by the printer.
 */
export function i2of5Modules(digits: number, ratio: number, checkDigit: boolean): number {
  let n = digits + (checkDigit ? 1 : 0);
  if (n % 2 === 1) n += 1;
  return n * (3 + 2 * ratio) + 6 + ratio;
}
