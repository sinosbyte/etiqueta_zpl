import { DesignElement, ElementType, displayValue } from '../types';
import { MessageKey } from '../i18n';

export interface Layer {
  id: string;
  type: ElementType;
  /** Name of the element type (i18n key). */
  typeKey: MessageKey;
  /** What it holds, short: the text, the barcode data, "{{VAR}}"... Empty when there is nothing to show. */
  detail: string;
}

const TYPE_KEYS: Partial<Record<ElementType, MessageKey>> = {
  text: 'element.text',
  barcode128: 'element.barcode128',
  barcodeI2of5: 'element.barcodeI2of5',
  qrcode: 'element.qrcode',
  rect: 'element.rect',
  line: 'element.line',
  image: 'element.image',
};

const MAX_DETAIL = 24;

const shorten = (text: string) => {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > MAX_DETAIL ? `${one.slice(0, MAX_DETAIL - 1)}…` : one;
};

/**
 * The elements the canvas draws, top layer first (the last element of the list is printed last,
 * so it is on top). Comments and raw ZPL are not drawn and are left out, as on the canvas.
 */
export function layerList(elements: DesignElement[]): Layer[] {
  const layers: Layer[] = [];
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    const typeKey = TYPE_KEYS[el.type];
    if (!typeKey) continue;
    const hasText = el.type === 'text' || el.type === 'barcode128' || el.type === 'barcodeI2of5' || el.type === 'qrcode';
    layers.push({ id: el.id, type: el.type, typeKey, detail: hasText ? shorten(displayValue(el) ?? '') : '' });
  }
  return layers;
}
