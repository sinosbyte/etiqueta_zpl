// Data Matrix (^BX), ECC 200 only (quality 200), square symbols.

// Modules per side of the square ECC 200 symbols; ^BX ... ,c,r can ask for one of them.
// Without it the printer picks the smallest that holds the data.
export const DATAMATRIX_SIZES: readonly number[] = [
  10, 12, 14, 16, 18, 20, 22, 24, 26, 32, 36, 40, 44, 48, 52, 64, 72, 80, 88, 96, 104, 120, 132, 144,
];

// ^BX h: dots per module
export const DATAMATRIX_MIN_MODULE = 1;
export const DATAMATRIX_MAX_MODULE = 20;
export const DATAMATRIX_DEFAULT_MODULE = 4;

// Modules per side assumed when the ZPL gives a module size but no symbol size: the real count
// depends on the data, and the editor works it out. Only used to give the element a first box.
export const DATAMATRIX_PARSED_MODULES = 16;
