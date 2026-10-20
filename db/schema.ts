import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const entries = sqliteTable("entries", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  sourceId: text("source_id").notNull(),
  publishedAt: text("published_at").notNull(),
  discoveredAt: text("discovered_at").notNull(),
  data: text("data").notNull(),
});
export const follows = sqliteTable("follows", {
  showId: text("show_id").primaryKey(),
  followedAt: text("followed_at").notNull(),
  mode: text("mode").notNull().default("digest"),
});
export const saved = sqliteTable("saved", {
  entryId: text("entry_id").primaryKey(),
  createdAt: text("created_at").notNull(),
});
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
export const deliveries = sqliteTable("deliveries", {
  id: text("id").primaryKey(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  message: text("message").notNull(),
});
export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  added: integer("added").notNull().default(0),
  details: text("details").notNull(),
});
