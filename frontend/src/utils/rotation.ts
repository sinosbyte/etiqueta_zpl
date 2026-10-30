import { Orientation } from '../types';

// ZPL orientation: N normal, R rotated 90° clockwise, I inverted 180°, B read bottom-up (270°)
export const ROTATION_DEGREES: Record<Orientation, number> = { N: 0, R: 90, I: 180, B: 270 };

export const ORIENTATION_LABELS: Record<Orientation, string> = {
  N: 'Normal',
  R: 'Rotated 90°',
  I: 'Inverted 180°',
  B: 'Bottom-up 270°',
};

// A quarter turn swaps width and height on the canvas
export const isQuarterTurn = (o: Orientation | undefined): boolean => o === 'R' || o === 'B';

// Footprint on the canvas of a box drawn width x height before turning
export const turnedSize = (o: Orientation | undefined, width: number, height: number) =>
  isQuarterTurn(o) ? { width: height, height: width } : { width, height };
