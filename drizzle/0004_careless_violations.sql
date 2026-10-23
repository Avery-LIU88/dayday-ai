CREATE TABLE `pipeline_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`purpose` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`charge_micro` integer NOT NULL,
	`reserved_micro` integer NOT NULL,
	`response` text,
	`usage` text,
	`error` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pipeline_calls_day` ON `pipeline_calls` (`day`);--> statement-breakpoint
CREATE TABLE `pipeline_events` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`candidate` text NOT NULL,
	`data` text,
	`heat` integer,
	`importance` integer,
	`recency` integer,
	`reliability` integer,
	`published_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pipeline_items` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`published_at` text NOT NULL,
	`raw` text NOT NULL,
	`content_hash` text NOT NULL,
	`status` text DEFAULT 'collected' NOT NULL,
	`analysis` text,
	`duplicate_of` text,
	`event_id` text,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pipeline_items_stage` ON `pipeline_items` (`status`,`published_at`);--> statement-breakpoint
CREATE INDEX `pipeline_items_event` ON `pipeline_items` (`event_id`);--> statement-breakpoint
CREATE INDEX `pipeline_items_hash` ON `pipeline_items` (`content_hash`);--> statement-breakpoint
CREATE TABLE `pipeline_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`stage` text NOT NULL,
	`status` text NOT NULL,
	`result` text NOT NULL,
	`version` text NOT NULL,
	`updated_at` text NOT NULL
);
