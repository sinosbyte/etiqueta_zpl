import { pgTable, serial, bigserial, smallint, text, integer, timestamp, unique, jsonb, index, boolean, uuid, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { PagesConfig } from '../zpl/types';

// A company owns users and designs (migration 0010). Stage 1 of the users/companies work only stores this: who sees what
// and who may do what is still decided by the user, as before.
export const companiesTable = pgTable('companies', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),
  // The company of the Sinosbyte administrators (0014): no designs, no tokens, never listed among the clients
  isPlatform: boolean('is_platform').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/** 'platform_admin' (Sinosbyte: templates and companies), 'company_admin' (the users of its company) or 'member'. users.is_admin mirrors platform_admin. */
export type UserRole = 'platform_admin' | 'company_admin' | 'member';

export const usersTable = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  isAdmin: boolean('is_admin').notNull().default(false),
  companyId: integer('company_id').notNull().references(() => companiesTable.id),
  email: text('email'),
  role: text('role').$type<UserRole>().notNull().default('member'),
  active: boolean('active').notNull().default(true),
  // A password set by an administrator (new user, reset) is temporary: it must be changed at the first login (0012)
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('idx_users_company_id').on(t.companyId)]);

export const designsTable = pgTable('designs', {
  id: serial('id').primaryKey(),
  // Who created it. A user with designs cannot be deleted (0012): users are deactivated, the designs belong to the company
  userId: integer('user_id').notNull().references(() => usersTable.id, { onDelete: 'restrict' }),
  // The company that owns it (migration 0011): every user of the company reaches it; user_id is who created it
  companyId: integer('company_id').notNull().references(() => companiesTable.id),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('uq_designs_company_name').on(t.companyId, t.name), index('idx_designs_user_id').on(t.userId), index('idx_designs_company_id').on(t.companyId)]);

export const refreshTokensTable = pgTable('refresh_tokens', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
  // SHA-256 hex of the opaque refresh token — never store the raw token.
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const designVersionsTable = pgTable('design_versions', {
  id: serial('id').primaryKey(),
  designId: integer('design_id').notNull().references(() => designsTable.id, { onDelete: 'cascade' }),
  versionNumber: integer('version_number').notNull(),
  zpl: text('zpl').notNull(),
  elementsJson: jsonb('elements_json').notNull().$type<object[]>(),
  labelWidth: integer('label_width').notNull(),
  labelHeight: integer('label_height').notNull(),
  // Example value per {{variable}}, for the preview; null when none was saved
  sampleValues: jsonb('sample_values').$type<Record<string, string>>(),
  // How the pages print (the first once, the second repeated) and the test records of its tables; null = one page
  pagesConfig: jsonb('pages_config').$type<PagesConfig>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [unique().on(t.designId, t.versionNumber)]);

export const templatesTable = pgTable('templates', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description').notNull().default(''),
  zpl: text('zpl').notNull(),
  elementsJson: jsonb('elements_json').notNull().$type<object[]>(),
  labelWidth: integer('label_width').notNull(),
  labelHeight: integer('label_height').notNull(),
  // One of TEMPLATE_CATEGORIES (templates/categories.ts); the Templates page groups by it
  category: text('category').notNull().default('outros'),
  createdBy: integer('created_by').references(() => usersTable.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const apiTokensTable = pgTable('api_tokens', {
  id: serial('id').primaryKey(),
  // The company whose designs the token reads (0013): the token belongs to the company, not to a person
  companyId: integer('company_id').notNull().references(() => companiesTable.id),
  // Who generated it (informative); NULL once that user is deleted, and the token keeps working
  userId: integer('user_id').references(() => usersTable.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  // Keyed hash (HMAC-SHA256, hex) of the raw token: the raw token is shown once at creation and never stored.
  tokenHash: text('token_hash').notNull().unique(),
  prefix: text('prefix').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at'),
  expiresAt: timestamp('expires_at'),
  revokedAt: timestamp('revoked_at'),
}, (t) => [index('idx_api_tokens_user_id').on(t.userId), index('idx_api_tokens_company_id').on(t.companyId)]);

// Named sets of test data of a design (values of the variables + the records of its tables). They belong to the
// design, not to one of its versions, and are saved on their own: loading one never touches the design.
export const designTestVariantsTable = pgTable('design_test_variants', {
  id: uuid('id').primaryKey().defaultRandom(),
  designId: integer('design_id').notNull().references(() => designsTable.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sampleValues: jsonb('sample_values').notNull().$type<Record<string, string>>().default({}),
  records: jsonb('records').notNull().$type<Record<string, string>[]>().default([]),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_design_test_variants_name').on(t.designId, sql`lower(${t.name})`),
  index('idx_design_test_variants_design').on(t.designId),
]);

// Use of the Labelary service (see labelary/quota.ts and drizzle/0009_labelary_quota.sql): one row per request sent,
// the block the service asked for when its own quota ran out, and the room kept for a mass export.
export const labelaryRequestsTable = pgTable('labelary_requests', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
  userId: integer('user_id'),
}, (t) => [index('idx_labelary_requests_sent_at').on(t.sentAt)]);

export const labelaryBlockTable = pgTable('labelary_block', {
  id: smallint('id').primaryKey(),
  until: timestamp('until', { withTimezone: true }).notNull(),
  reason: text('reason').notNull(),
  setAt: timestamp('set_at', { withTimezone: true }).notNull(),
});

export const labelaryHoldsTable = pgTable('labelary_holds', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: integer('user_id').notNull(),
  slots: integer('slots').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex('uq_labelary_holds_user').on(t.userId)]);
