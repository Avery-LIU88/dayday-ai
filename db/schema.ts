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
export const readers = sqliteTable("readers", {
  id: text("id").primaryKey(),
  preferences: text("preferences").notNull(),
  bot: text("bot"),
  createdAt: text("created_at").notNull(),
});
export const shows = sqliteTable("shows", {
  id: text("id").primaryKey(),
  data: text("data").notNull(),
  checkedAt: text("checked_at").notNull(),
  error: text("error"),
});
export const subscriptions = sqliteTable("subscriptions", {
  id: text("id").primaryKey(),
  readerId: text("reader_id").notNull(),
  showId: text("show_id").notNull(),
  followedAt: text("followed_at").notNull(),
  mode: text("mode").notNull().default("instant"),
});
export const notices = sqliteTable("notices", {
  id: text("id").primaryKey(),
  readerId: text("reader_id").notNull(),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  message: text("message").notNull(),
});
export const feedback = sqliteTable("feedback", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  submissionKey: text("submission_key").notNull().unique(),
  payloadHash: text("payload_hash").notNull(),
  content: text("content").notNull(),
  email: text("email").notNull().default(""),
  pageUrl: text("page_url").notNull().default(""),
  createdAt: text("created_at").notNull(),
});
export const feedbackLimits = sqliteTable("feedback_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(1),
  expiresAt: integer("expires_at").notNull(),
});
