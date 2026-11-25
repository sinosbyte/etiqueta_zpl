import { eq, and, sql, count, desc } from 'drizzle-orm';
import { getDb, isUniqueViolation } from '../db/database';
import { designsTable, designVersionsTable, usersTable } from '../db/schema';
import { inCompanyOf } from './scope';
import { isAdminRole } from '../auth/account';
import { Element, PagesConfig } from '../zpl/types';
import { elementsFitPages } from '../zpl/schema';

export interface DesignPayload {
  zpl: string;
  elements: Element[];
  labelWidth: number;
  labelHeight: number;
  sampleValues?: Record<string, string>;  // example value per {{variable}}; omitted = none
  // How the pages print and the test records of the tables. Omitted on an update = the saved one stays;
  // null = back to one page; omitted on a new version = one page
  pagesConfig?: PagesConfig | null;
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
  pagesConfig: PagesConfig | null;  // null = a design of one page (every version saved before pages existed)
  createdAt: string;
}

function toIso(d: Date | string): string {
  return typeof d === 'string' ? d : d.toISOString();
}

export async function createDesign(userId: number, name: string, payload: DesignPayload): Promise<{ designId: number; versionId: number }> {
  const db = getDb();
  let designId: number;
  try {
    // The design belongs to the company of whoever creates it, and every user of the company reaches it
    const owner = await db.select({ companyId: usersTable.companyId }).from(usersTable).where(eq(usersTable.id, userId));
    if (!owner[0]) throw new Error('USER_NOT_FOUND');
    const rows = await db.insert(designsTable).values({ userId, name, companyId: owner[0].companyId }).returning({ id: designsTable.id });
    designId = rows[0].id;
  } catch (e) {
    // PG unique_violation — only the (company_id, name) index can fire here
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
    .where(inCompanyOf(userId));
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
    .where(inCompanyOf(userId))
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
    .where(and(eq(designsTable.id, designId), inCompanyOf(userId)))
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
      .where(and(eq(designsTable.id, designId), inCompanyOf(userId)))
      .returning();
    if (!rows.length) return undefined;
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error('DESIGN_NAME_TAKEN');
    throw e;
  }
  return getDesign(userId, designId);
}

/**
 * Deletes a design of the user's company: only the user who created it or an administrator of the company may.
 * false = no such design in the company; throws DELETE_NOT_ALLOWED when it exists but this user may not delete it.
 */
export async function deleteDesign(userId: number, designId: number): Promise<boolean> {
  const db = getDb();
  const [design] = await db.select({ createdBy: designsTable.userId }).from(designsTable)
    .where(and(eq(designsTable.id, designId), inCompanyOf(userId)));
  if (!design) return false;
  if (design.createdBy !== userId) {
    const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
    if (!user || !isAdminRole(user.role)) throw new Error('DELETE_NOT_ALLOWED');
  }
  const rows = await db
    .delete(designsTable)
    .where(and(eq(designsTable.id, designId), inCompanyOf(userId)))
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
    pagesConfig: payload.pagesConfig ?? null,
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
    .where(and(eq(designsTable.id, designId), inCompanyOf(userId)));
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
    pagesConfig: r.pagesConfig ?? null,
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

  // An update that leaves the pages alone must still not put an element on a page the saved design lacks
  if (payload.pagesConfig === undefined && payload.elements.some(el => (el.page ?? 0) > 0)) {
    const saved = await db.select({ pagesConfig: designVersionsTable.pagesConfig }).from(designVersionsTable)
      .where(and(eq(designVersionsTable.designId, designId), eq(designVersionsTable.versionNumber, versionNumber)));
    if (saved[0] && !elementsFitPages(payload.elements, saved[0].pagesConfig)) throw new Error('PAGES_MISMATCH');
  }

  const rows = await db
    .update(designVersionsTable)
    .set({
      zpl: payload.zpl,
      elementsJson: payload.elements as object[],
      labelWidth: payload.labelWidth,
      labelHeight: payload.labelHeight,
      // A client that does not send them leaves the saved ones alone
      ...(payload.sampleValues !== undefined && { sampleValues: payload.sampleValues }),
      // Same for the pages: only a client that sends them (or null, to go back to one page) changes them
      ...(payload.pagesConfig !== undefined && { pagesConfig: payload.pagesConfig }),
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
