CREATE TABLE `feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`submission_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`content` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`page_url` text DEFAULT '' NOT NULL,
	`screenshot_key` text,
	`screenshot_type` text,
	`screenshot_name` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feedback_submission_key_unique` ON `feedback` (`submission_key`);--> statement-breakpoint
CREATE TABLE `feedback_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`expires_at` integer NOT NULL
);
