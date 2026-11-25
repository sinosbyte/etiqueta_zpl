import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb, isUniqueViolation } from '../db/database';
import { designsTable, designTestVariantsTable } from '../db/schema';
import { inCompanyOf, Who } from './scope';

/**
 * At most this many variants per design. Each one is a few KB of text (values + up to 500 records, and the
 * request body is already capped at 512 KB), so 50 keeps a design's variants small while being far more than
 * anyone names by hand. A limit with a clear error is better than a list nobody can scan.
 */
export const MAX_VARIANTS_PER_DESIGN = 50;

export type Values = Record<string, string>;

export interface VariantSummary {
  id: string;
  name: string;
  valueCount: number;
  recordCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface VariantDetail extends VariantSummary {
  sampleValues: Values;
  records: Values[];
}

export interface VariantData {
  name: string;
  sampleValues: Values;
  records: Values[];
}

type Row = typeof designTestVariantsTable.$inferSelect;

const iso = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString());

function toSummary(r: Row): VariantSummary {
  return {
    id: r.id, name: r.name,
    valueCount: Object.keys(r.sampleValues ?? {}).length,
    recordCount: (r.records ?? []).length,
    createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt),
  };
}

function toDetail(r: Row): VariantDetail {
  return { ...toSummary(r), sampleValues: r.sampleValues ?? {}, records: r.records ?? [] };
}

/** Variants are reached only through a design of the user's company: another company's design is simply "not found". */
async function ownsDesign(who: Who, designId: number): Promise<boolean> {
  const rows = await getDb().select({ id: designsTable.id }).from(designsTable)
    .where(and(eq(designsTable.id, designId), inCompanyOf(who)));
  return rows.length > 0;
}

const where = (designId: number, id: string) =>
  and(eq(designTestVariantsTable.designId, designId), eq(designTestVariantsTable.id, id));

/** The list, oldest first (a stable order), without the data of each. undefined = the design is not the user's. */
export async function listVariants(who: Who, designId: number): Promise<VariantSummary[] | undefined> {
  if (!await ownsDesign(who, designId)) return undefined;
  const rows = await getDb().select().from(designTestVariantsTable)
    .where(eq(designTestVariantsTable.designId, designId))
    .orderBy(asc(designTestVariantsTable.createdAt), asc(designTestVariantsTable.name));
  return rows.map(toSummary);
}

export async function getVariant(who: Who, designId: number, id: string): Promise<VariantDetail | undefined> {
  if (!await ownsDesign(who, designId)) return undefined;
  const rows = await getDb().select().from(designTestVariantsTable).where(where(designId, id));
  return rows[0] ? toDetail(rows[0]) : undefined;
}

/** Throws VARIANT_NAME_TAKEN (same name, any case, in this design) or VARIANT_LIMIT. undefined = design not found. */
export async function createVariant(userId: number, designId: number, data: VariantData): Promise<VariantDetail | undefined> {
  if (!await ownsDesign(userId, designId)) return undefined;
  const db = getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(designTestVariantsTable)
    .where(eq(designTestVariantsTable.designId, designId));
  if (n >= MAX_VARIANTS_PER_DESIGN) throw new Error('VARIANT_LIMIT');
  try {
    const rows = await db.insert(designTestVariantsTable)
      .values({ designId, name: data.name, sampleValues: data.sampleValues, records: data.records })
      .returning();
    return toDetail(rows[0]);
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error('VARIANT_NAME_TAKEN');
    throw e;
  }
}

/** Changes only the fields given (a rename, new data, or both). undefined = not found. */
export async function updateVariant(
  userId: number, designId: number, id: string, patch: Partial<VariantData>,
): Promise<VariantDetail | undefined> {
  if (!await ownsDesign(userId, designId)) return undefined;
  const set: Partial<typeof designTestVariantsTable.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.sampleValues !== undefined) set.sampleValues = patch.sampleValues;
  if (patch.records !== undefined) set.records = patch.records;
  try {
    const rows = await getDb().update(designTestVariantsTable).set(set).where(where(designId, id)).returning();
    return rows[0] ? toDetail(rows[0]) : undefined;
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error('VARIANT_NAME_TAKEN');
    throw e;
  }
}

export async function deleteVariant(userId: number, designId: number, id: string): Promise<boolean> {
  if (!await ownsDesign(userId, designId)) return false;
  const rows = await getDb().delete(designTestVariantsTable).where(where(designId, id))
    .returning({ id: designTestVariantsTable.id });
  return rows.length > 0;
}
