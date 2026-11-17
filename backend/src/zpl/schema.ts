import { z } from 'zod';
import { DATAMATRIX_MAX_MODULE, DATAMATRIX_MIN_MODULE, DATAMATRIX_SIZES } from './datamatrix';
import {
  TABLE_FIELD_PATTERN, TABLE_MAX_CAPACITY, TABLE_MAX_COLUMNS, TABLE_MAX_ROW_HEIGHT, TABLE_MIN_ROW_HEIGHT,
} from './table';

/** One column of a table element. */
export const TableColumnSchema = z.object({
  header: z.string().max(60),
  field: z.string().regex(TABLE_FIELD_PATTERN),
  width: z.number().int().min(1).max(10_000),
  align: z.enum(['L', 'C', 'R']),
});

/**
 * How the pages of a design are printed. At most two (the limit of this version): the first is
 * printed once ('first'), the second ('repeat') as often as the records left over need.
 */
export const PagesSchema = z.array(z.object({ mode: z.enum(['first', 'repeat']) }))
  .min(1)
  .max(2)
  .refine(pages => pages[0]?.mode === 'first' && (pages.length < 2 || pages[1].mode === 'repeat'),
    'The first page is "first" and the second one "repeat"');

/**
 * Zod schema for a single design element, shared by the ZPL and designs
 * routes so both endpoints validate and type elements identically.
 */
export const ElementSchema = z.object({
  id: z.string(),
  type: z.enum(['text', 'barcode128', 'barcodeI2of5', 'qrcode', 'datamatrix', 'rect', 'line', 'image', 'comment', 'raw', 'table']),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  value: z.string().optional(),
  fontSize: z.number().optional(),
  fontWidth: z.number().optional(),
  fontName: z.string().optional(),
  fontSource: z.enum(['cf', 'a']).optional(),
  reversed: z.boolean().optional(),
  filled: z.boolean().optional(),
  thickness: z.number().optional(),
  color: z.enum(['B', 'W']).optional(),
  rounding: z.number().int().min(0).max(8).optional(),
  qrErrorCorrection: z.enum(['H', 'Q', 'M', 'L']).optional(),
  qrMagnification: z.number().int().min(1).max(10).optional(),
  dmModuleSize: z.number().int().min(DATAMATRIX_MIN_MODULE).max(DATAMATRIX_MAX_MODULE).optional(),
  dmSize: z.number().int().refine(n => DATAMATRIX_SIZES.includes(n), 'Not a square ECC 200 Data Matrix size').optional(),
  origin: z.literal('FT').optional(),
  hexUtf8: z.boolean().optional(),
  block: z.object({
    maxLines: z.number().int().min(1),
    lineSpacing: z.number(),
    justify: z.enum(['L', 'C', 'R', 'J']),
    hangingIndent: z.number(),
  }).optional(),
  orientation: z.enum(['N', 'R', 'I', 'B']).optional(),
  moduleWidth: z.number().positive().optional(),
  expectedChars: z.number().int().positive().optional(),
  ratio: z.number().positive().optional(),
  printLine: z.boolean().optional(),
  codeSet: z.enum(['A', 'B', 'C']).optional(),
  codeAuto: z.boolean().optional(),
  lineAbove: z.boolean().optional(),
  checkDigit: z.boolean().optional(),
  dynamic: z.boolean().optional(),
  variableName: z.string().optional(),
  bytesPerRow: z.number().int().positive().optional(),
  page: z.number().int().min(0).max(1).optional(),
  columns: z.array(TableColumnSchema).min(1).max(TABLE_MAX_COLUMNS).optional(),
  rowHeight: z.number().int().min(TABLE_MIN_ROW_HEIGHT).max(TABLE_MAX_ROW_HEIGHT).optional(),
  headerRow: z.boolean().optional(),
  rowsPerPage: z.number().int().min(1).max(TABLE_MAX_CAPACITY).optional(),
  cellPadding: z.number().int().min(0).max(100).optional(),
});

export type ElementInput = z.infer<typeof ElementSchema>;

/** Values of {{variables}}, or one record of a table: names as in the ZPL, a bounded number of short values. */
export const ValuesSchema = z.record(z.string().regex(/^[A-Za-z0-9_]{1,60}$/), z.string().max(255))
  .refine(values => Object.keys(values).length <= 200, 'Too many values');

/** The records a table prints: at most 500, which is what the simulation works out. */
export const RecordsSchema = z.array(ValuesSchema).max(500);

/** What a design version stores about its pages: how each prints and the test records of its tables. */
export const PagesConfigSchema = z.object({
  pages: PagesSchema,
  records: RecordsSchema.optional(),
});

/**
 * Whether the elements are all on pages the design has: a design with no configuration is one page,
 * so nothing may be on page 2 until the configuration says there are two.
 */
export function elementsFitPages(elements: { page?: number }[], config: { pages: unknown[] } | null | undefined): boolean {
  const pageCount = config?.pages.length ?? 1;
  return elements.every(el => (el.page ?? 0) < pageCount);
}
