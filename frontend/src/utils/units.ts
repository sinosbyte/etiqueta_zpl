/** 203 dpi printers: 8 dots per mm (the preview renders at 8 dpmm too), so 48 mm is exactly 384 dots. */
export const DOTS_PER_MM = 8;

/**
 * Canvas scale (screen px per dot) shown as "100%". 0.7 px per dot puts a
 * 100 x 150 mm label at roughly its real size on a monitor.
 */
export const ZOOM_100 = 0.7;
export const zoomToPercent = (zoom: number): number => Math.round((zoom / ZOOM_100) * 100);

export const mmToDots = (mm: number): number => Math.round(mm * DOTS_PER_MM);

/** Dots as mm. One dot is 0.125 mm, so three decimals are exact. */
export const dotsToMm = (dots: number): number =>
  parseFloat((dots / DOTS_PER_MM).toFixed(3));
