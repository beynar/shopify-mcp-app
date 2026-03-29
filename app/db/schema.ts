import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable("Session", {
  id: text("id").primaryKey(),
  shop: text("shop").notNull(),
  state: text("state").notNull(),
  isOnline: integer("isOnline", { mode: "boolean" }).notNull().default(false),
  scope: text("scope"),
  expires: integer("expires", { mode: "timestamp_ms" }),
  accessToken: text("accessToken").notNull(),
  userId: integer("userId", { mode: "number" }),
  firstName: text("firstName"),
  lastName: text("lastName"),
  email: text("email"),
  accountOwner: integer("accountOwner", { mode: "boolean" }).notNull().default(false),
  locale: text("locale"),
  collaborator: integer("collaborator", { mode: "boolean" }).default(false),
  emailVerified: integer("emailVerified", { mode: "boolean" }).default(false),
  refreshToken: text("refreshToken"),
  refreshTokenExpires: integer("refreshTokenExpires", { mode: "timestamp_ms" }),
});

export const mcpConnections = sqliteTable("McpConnection", {
  connectionKey: text("key").primaryKey(),
  shop: text("shop").notNull().unique(),
  sessionId: text("sessionId").notNull(),
  secretHash: text("secretHash"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
});

export const mcpSecrets = sqliteTable("McpSecret", {
  id: text("id").primaryKey(),
  connectionKey: text("connectionKey").notNull(),
  shop: text("shop").notNull(),
  label: text("label").notNull(),
  secretCiphertext: text("secretCiphertext"),
  secretHash: text("secretHash").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
  revokedAt: integer("revokedAt", { mode: "timestamp_ms" }),
});

export type SessionRow = typeof sessions.$inferSelect;
export type SessionInsert = typeof sessions.$inferInsert;
export type McpConnectionRow = typeof mcpConnections.$inferSelect;
export type McpConnectionInsert = typeof mcpConnections.$inferInsert;
export type McpSecretRow = typeof mcpSecrets.$inferSelect;
export type McpSecretInsert = typeof mcpSecrets.$inferInsert;
