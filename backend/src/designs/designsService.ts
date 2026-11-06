import { eq, and, sql, count, desc } from 'drizzle-orm';
import { getDb, isUniqueViolation } from '../db/database';
import { designsTable, designVersionsTable } from '../db/schema';
import { Element } from '../zpl/types';

export interface DesignPayload {
  zpl: string;
  elements: Element[];
  labelWidth: number;
  labelHeight: number;
  sampleValues?: Record<string, string>;  // example value per {{variable}}; omitted = none
}

export interface DesignSummary {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  versionCount: number;
}

export interface VersionSummary {
  id: number;
  versionNumber: number;
  createdAt: string;
}

/** A page of results plus the total count for building pagination controls. */
export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface PageParams {
  limit: number;
  offset: number;
}

export interface VersionDetail {
  id: number;
  versionNumber: number;
  zpl: string;
  elements: Element[];
  labelWidth: number;
  labelHeight: number;
  sampleValues: Record<string, string>;
  createdAt: string;
}

function toIso(d: Date | string): string {
  return typeof d === 'string' ? d : d.toISOString();
}

export async function createDesign(userId: number, name: string, payload: DesignPayload): Promise<{ designId: number; versionId: number }> {
  const db = getDb();
  let designId: number;
  try {
    const rows = await db.insert(designsTable).values({ userId, name }).returning({ id: designsTable.id });
    designId = rows[0].id;
  } catch (e) {
    // PG unique_violation — only the (user_id, name) constraint can fire here
    if (isUniqueViolation(e)) throw new Error('DESIGN_NAME_TAKEN');
    throw e;
  }
  const versionId = await insertVersion(designId, payload);
  return { designId, versionId };
}

export async function listDesigns(userId: number, page: PageParams): Promise<Paginated<DesignSummary>> {
  const db = getDb();
  const totalRows = await db
    .select({ n: count() })
    .from(designsTable)
    .where(eq(designsTable.userId, userId));
  const total = Number(totalRows[0]?.n ?? 0);

  const rows = await db
    .select({
      id: designsTable.id,
      name: designsTable.name,
      createdAt: designsTable.createdAt,
      updatedAt: designsTable.updatedAt,
      versionCount: count(designVersionsTable.id),
    })
    .from(designsTable)
    .leftJoin(designVersionsTable, eq(designVersionsTable.designId, designsTable.id))
    .where(eq(designsTable.userId, userId))
    .groupBy(designsTable.id)
    .orderBy(sql`${designsTable.updatedAt} DESC`)
    .limit(page.limit)
    .offset(page.offset);

  const items = rows.map(r => ({
    id: r.id,
    name: r.name,
    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
    versionCount: Number(r.versionCount),
  }));
  return { items, total, limit: page.limit, offset: page.offset };
}

export async function getDesign(userId: number, designId: number): Promise<DesignSummary | undefined> {
  const db = getDb();
  const rows = await db
    .select({
      id: designsTable.id,
      name: designsTable.name,
      createdAt: designsTable.createdAt,
      updatedAt: designsTable.updatedAt,
      versionCount: count(designVersionsTable.id),
    })
    .from(designsTable)
    .leftJoin(designVersionsTable, eq(designVersionsTable.designId, designsTable.id))
    .where(and(eq(designsTable.id, designId), eq(designsTable.userId, userId)))
    .groupBy(designsTable.id);
  const r = rows[0];
  if (!r) return undefined;
  return { id: r.id, name: r.name, createdAt: toIso(r.createdAt), updatedAt: toIso(r.updatedAt), versionCount: Number(r.versionCount) };
}

export interface DesignDetail extends DesignSummary {
  version: VersionDetail;
}

export async function getDesignWithVersion(userId: number, designId: number, versionNumber?: number): Promise<DesignDetail | undefined> {
  const summary = await getDesign(userId, designId);
  if (!summary) return undefined;
  const version = versionNumber !== undefined
    ? await getVersion(userId, designId, versionNumber)
    : await getLatestVersion(userId, designId);
  if (!version) return undefined;
  return { ...summary, version };
}

export async function getLatestVersion(userId: number, designId: number): Promise<VersionDetail | undefined> {
  if (!await ownershipCheck(userId, designId)) return undefined;
  const rows = await getDb().select().from(designVersionsTable)
    .where(eq(designVersionsTable.designId, designId))
    .orderBy(desc(designVersionsTable.versionNumber))
    .limit(1);
  return rows[0] ? toVersionDetail(rows[0]) : undefined;
}

export async function renameDesign(userId: number, designId: number, name: string): Promise<DesignSummary | undefined> {
  const db = getDb();
  try {
    const rows = await db
      .update(designsTable)
      .set({ name, updatedAt: new Date() })
      .where(and(eq(designsTable.id, designId), eq(designsTable.userId, userId)))
      .returning();
    if (!rows.length) return undefined;
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error('DESIGN_NAME_TAKEN');
    throw e;
  }
  return getDesign(userId, designId);
}

export async function deleteDesign(userId: number, designId: number): Promise<boolean> {
  const rows = await getDb()
    .delete(designsTable)
    .where(and(eq(designsTable.id, designId), eq(designsTable.userId, userId)))
    .returning({ id: designsTable.id });
  return rows.length > 0;
}

async function insertVersion(designId: number, payload: DesignPayload): Promise<number> {
  const db = getDb();
  const maxRows = await db
    .select({ max: sql<number>`COALESCE(MAX(${designVersionsTable.versionNumber}), 0)` })
    .from(designVersionsTable)
    .where(eq(designVersionsTable.designId, designId));
  const nextVn = Number(maxRows[0].max) + 1;
  const rows = await db.insert(designVersionsTable).values({
    designId,
    versionNumber: nextVn,
    zpl: payload.zpl,
    elementsJson: payload.elements as object[],
    labelWidth: payload.labelWidth,
    labelHeight: payload.labelHeight,
    sampleValues: payload.sampleValues ?? null,
  }).returning({ id: designVersionsTable.id });
  await db.update(designsTable).set({ updatedAt: new Date() }).where(eq(designsTable.id, designId));
  return rows[0].id;
}

export async function createVersion(userId: number, designId: number, payload: DesignPayload): Promise<VersionDetail> {
  if (!await ownershipCheck(userId, designId)) throw new Error('DESIGN_NOT_FOUND');
  const versionId = await insertVersion(designId, payload);
  const rows = await getDb().select().from(designVersionsTable).where(eq(designVersionsTable.id, versionId));
  return toVersionDetail(rows[0]);
}

export async function listVersions(userId: number, designId: number, page: PageParams): Promise<Paginated<VersionSummary>> {
  if (!await ownershipCheck(userId, designId)) {
    return { items: [], total: 0, limit: page.limit, offset: page.offset };
  }
  const db = getDb();
  const totalRows = await db
    .select({ n: count() })
    .from(designVersionsTable)
    .where(eq(designVersionsTable.designId, designId));
  const total = Number(totalRows[0]?.n ?? 0);

  const rows = await db.select({
    id: designVersionsTable.id,
    versionNumber: designVersionsTable.versionNumber,
    createdAt: designVersionsTable.createdAt,
  }).from(designVersionsTable)
    .where(eq(designVersionsTable.designId, designId))
    .orderBy(desc(designVersionsTable.versionNumber)) // newest first
    .limit(page.limit)
    .offset(page.offset);

  const items = rows.map(r => ({ id: r.id, versionNumber: r.versionNumber, createdAt: toIso(r.createdAt) }));
  return { items, total, limit: page.limit, offset: page.offset };
}

export async function getVersion(userId: number, designId: number, versionNumber: number): Promise<VersionDetail | undefined> {
  if (!await ownershipCheck(userId, designId)) return undefined;
  const rows = await getDb().select().from(designVersionsTable)
    .where(and(eq(designVersionsTable.designId, designId), eq(designVersionsTable.versionNumber, versionNumber)));
  return rows[0] ? toVersionDetail(rows[0]) : undefined;
}

async function ownershipCheck(userId: number, designId: number): Promise<boolean> {
  const rows = await getDb()
    .select({ id: designsTable.id })
    .from(designsTable)
    .where(and(eq(designsTable.id, designId), eq(designsTable.userId, userId)));
  return rows.length > 0;
}

function toVersionDetail(r: typeof designVersionsTable.$inferSelect): VersionDetail {
  return {
    id: r.id,
    versionNumber: r.versionNumber,
    zpl: r.zpl,
    elements: r.elementsJson as unknown as Element[],
    labelWidth: r.labelWidth,
    labelHeight: r.labelHeight,
    sampleValues: r.sampleValues ?? {},
    createdAt: toIso(r.createdAt),
  };
}

export async function updateVersion(
  userId: number,
  designId: number,
  versionNumber: number,
  payload: DesignPayload
): Promise<VersionDetail | undefined> {
  const db = getDb();
  if (!await ownershipCheck(userId, designId)) return undefined;

  const rows = await db
    .update(designVersionsTable)
    .set({
      zpl: payload.zpl,
      elementsJson: payload.elements as object[],
      labelWidth: payload.labelWidth,
      labelHeight: payload.labelHeight,
      // A client that does not send them leaves the saved ones alone
      ...(payload.sampleValues !== undefined && { sampleValues: payload.sampleValues }),
    })
    .where(and(
      eq(designVersionsTable.designId, designId),
      eq(designVersionsTable.versionNumber, versionNumber)
    ))
    .returning();

  if (!rows.length) return undefined;
  await db.update(designsTable).set({ updatedAt: new Date() }).where(eq(designsTable.id, designId));
  return toVersionDetail(rows[0]);
}
