import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

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

export const pipelineItems = sqliteTable('pipeline_items', {
  id: text('id').primaryKey(), sourceId: text('source_id').notNull(),
  publishedAt: text('published_at').notNull(), raw: text('raw').notNull(),
  contentHash: text('content_hash').notNull(), status: text('status').notNull().default('collected'),
  analysis: text('analysis'), duplicateOf: text('duplicate_of'), eventId: text('event_id'),
  error: text('error'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, t=>[index('pipeline_items_stage').on(t.status,t.publishedAt),index('pipeline_items_event').on(t.eventId),index('pipeline_items_hash').on(t.contentHash)]);
export const pipelineSteps = sqliteTable('pipeline_steps', {
  id:text('id').primaryKey(),itemId:text('item_id').notNull(),stage:text('stage').notNull(),
  status:text('status').notNull(),result:text('result').notNull(),version:text('version').notNull(),updatedAt:text('updated_at').notNull(),
});
export const pipelineEvents = sqliteTable('pipeline_events', {
  id:text('id').primaryKey(),parentId:text('parent_id'),candidate:text('candidate').notNull(),data:text('data'),
  heat:integer('heat'),importance:integer('importance'),recency:integer('recency'),reliability:integer('reliability'),
  publishedAt:text('published_at').notNull(),updatedAt:text('updated_at').notNull(),
});
export const pipelineCalls = sqliteTable('pipeline_calls', {
  id:text('id').primaryKey(),day:text('day').notNull(),purpose:text('purpose').notNull(),model:text('model').notNull(),
  status:text('status').notNull(),chargeMicro:integer('charge_micro').notNull(),reservedMicro:integer('reserved_micro').notNull(),
  response:text('response'),usage:text('usage'),error:text('error'),createdAt:text('created_at').notNull(),
},t=>[index('pipeline_calls_day').on(t.day)]);
