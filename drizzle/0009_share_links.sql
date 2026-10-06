CREATE TABLE `guest_links` (
	`id` text PRIMARY KEY NOT NULL,
	`created_by` text,
	`label` text NOT NULL,
	`token_hash` text NOT NULL,
	`starts_at` integer,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`pin_hash` text,
	`pin_failures` integer DEFAULT 0 NOT NULL,
	`include_secrets` integer DEFAULT false NOT NULL,
	`sections_json` text NOT NULL,
	`locale` text DEFAULT 'de' NOT NULL,
	`last_viewed_at` integer,
	`view_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guest_links_token_hash_unique` ON `guest_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `guest_links_expires_at_idx` ON `guest_links` (`expires_at`);--> statement-breakpoint
CREATE TABLE `ical_feeds` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_enc` text NOT NULL,
	`scope` text DEFAULT 'mine' NOT NULL,
	`include_estimated` integer DEFAULT false NOT NULL,
	`include_preparations` integer DEFAULT true NOT NULL,
	`include_defects` integer DEFAULT true NOT NULL,
	`include_warranties` integer DEFAULT true NOT NULL,
	`alarm_time` text,
	`alarm_days_before` integer DEFAULT 0 NOT NULL,
	`locale` text DEFAULT 'de' NOT NULL,
	`last_fetched_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ical_feeds_token_hash_unique` ON `ical_feeds` (`token_hash`);--> statement-breakpoint
CREATE INDEX `ical_feeds_user_id_idx` ON `ical_feeds` (`user_id`);