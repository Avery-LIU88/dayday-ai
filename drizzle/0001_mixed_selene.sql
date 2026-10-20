CREATE TABLE `notices` (
	`id` text PRIMARY KEY NOT NULL,
	`reader_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`message` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `readers` (
	`id` text PRIMARY KEY NOT NULL,
	`preferences` text NOT NULL,
	`bot` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shows` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`checked_at` text NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`reader_id` text NOT NULL,
	`show_id` text NOT NULL,
	`followed_at` text NOT NULL,
	`mode` text DEFAULT 'instant' NOT NULL
);
