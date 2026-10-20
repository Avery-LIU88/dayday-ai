CREATE TABLE `deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`message` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `entries` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`source_id` text NOT NULL,
	`published_at` text NOT NULL,
	`discovered_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `follows` (
	`show_id` text PRIMARY KEY NOT NULL,
	`followed_at` text NOT NULL,
	`mode` text DEFAULT 'digest' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`added` integer DEFAULT 0 NOT NULL,
	`details` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `saved` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
