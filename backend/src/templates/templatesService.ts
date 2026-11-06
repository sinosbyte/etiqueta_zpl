import { eq, asc } from 'drizzle-orm';
import { getDb, isUniqueViolation } from '../db/database';
import { templatesTable, usersTable } from '../db/schema';
import { Element } from '../zpl/types';
import { DEFAULT_TEMPLATE_CATEGORY, TemplateCategory } from './categories';

export interface TemplatePayload {
  zpl: string;
  elements: Element[];
  labelWidth: number;
  labelHeight: number;
}

export interface TemplateSummary {
  id: number;
  name: string;
  description: string;
  category: string;
  labelWidth: number;
  labelHeight: number;
  updatedAt: string;
}

export interface TemplateDetail extends TemplateSummary {
  zpl: string;
  elements: Element[];
}

const summaryColumns = {
  id: templatesTable.id,
  name: templatesTable.name,
  description: templatesTable.description,
  category: templatesTable.category,
  labelWidth: templatesTable.labelWidth,
  labelHeight: templatesTable.labelHeight,
  updatedAt: templatesTable.updatedAt,
};

const toSummary = (r: { id: number; name: string; description: string; category: string; labelWidth: number; labelHeight: number; updatedAt: Date }): TemplateSummary =>
  ({ id: r.id, name: r.name, description: r.description, category: r.category, labelWidth: r.labelWidth, labelHeight: r.labelHeight, updatedAt: r.updatedAt.toISOString() });

/** True when the user is a Sinosbyte administrator (users.is_admin). */
export async function isAdmin(userId: number): Promise<boolean> {
  const rows = await getDb().select({ isAdmin: usersTable.isAdmin }).from(usersTable).where(eq(usersTable.id, userId));
  return rows[0]?.isAdmin === true;
}

export async function listTemplates(): Promise<TemplateSummary[]> {
  const rows = await getDb().select(summaryColumns).from(templatesTable).orderBy(asc(templatesTable.name));
  return rows.map(toSummary);
}

export async function getTemplate(id: number): Promise<TemplateDetail | undefined> {
  const rows = await getDb().select().from(templatesTable).where(eq(templatesTable.id, id));
  const r = rows[0];
  if (!r) return undefined;
  return { ...toSummary(r), zpl: r.zpl, elements: r.elementsJson as Element[] };
}

/** Throws TEMPLATE_NAME_TAKEN when another template already has the name. */
export async function createTemplate(
  userId: number, name: string, description: string, payload: TemplatePayload,
  category: TemplateCategory = DEFAULT_TEMPLATE_CATEGORY,
): Promise<{ id: number }> {
  try {
    const rows = await getDb().insert(templatesTable).values({
      name,
      description,
      category,
      zpl: payload.zpl,
      elementsJson: payload.elements,
      labelWidth: payload.labelWidth,
      labelHeight: payload.labelHeight,
      createdBy: userId,
    }).returning({ id: templatesTable.id });
    return { id: rows[0].id };
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error('TEMPLATE_NAME_TAKEN');
    throw e;
  }
}

/** Changes the name, description and category of a template and, when given, replaces its label. */
export async function updateTemplate(
  id: number,
  fields: { name?: string; description?: string; category?: TemplateCategory },
  payload?: TemplatePayload,
): Promise<boolean> {
  try {
    const rows = await getDb().update(templatesTable).set({
      ...fields,
      ...(payload && {
        zpl: payload.zpl,
        elementsJson: payload.elements,
        labelWidth: payload.labelWidth,
        labelHeight: payload.labelHeight,
      }),
      updatedAt: new Date(),
    }).where(eq(templatesTable.id, id)).returning({ id: templatesTable.id });
    return rows.length > 0;
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error('TEMPLATE_NAME_TAKEN');
    throw e;
  }
}

export async function deleteTemplate(id: number): Promise<boolean> {
  const rows = await getDb().delete(templatesTable).where(eq(templatesTable.id, id)).returning({ id: templatesTable.id });
  return rows.length > 0;
}
