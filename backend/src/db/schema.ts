import { pgTable, serial, text, integer, timestamp, unique, jsonb, index, boolean } from 'drizzle-orm/pg-core';

export const usersTable = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  isAdmin: boolean('is_admin').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const designsTable = pgTable('designs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [unique().on(t.userId, t.name), index('idx_designs_user_id').on(t.userId)]);

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
  createdBy: integer('created_by').references(() => usersTable.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const apiTokensTable = pgTable('api_tokens', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  // Keyed hash (HMAC-SHA256, hex) of the raw token: the raw token is shown once at creation and never stored.
  tokenHash: text('token_hash').notNull().unique(),
  prefix: text('prefix').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at'),
  expiresAt: timestamp('expires_at'),
  revokedAt: timestamp('revoked_at'),
}, (t) => [index('idx_api_tokens_user_id').on(t.userId)]);
