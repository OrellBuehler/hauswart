CREATE TABLE `calendar_links` (
	`id` text PRIMARY KEY NOT NULL,
	`target_id` text NOT NULL,
	`kind` text NOT NULL,
	`item_id` text NOT NULL,
	`instance_key` text DEFAULT '' NOT NULL,
	`ref` text NOT NULL,
	`remote_uid` text,
	`status` text DEFAULT 'synced' NOT NULL,
	`content_hash` text NOT NULL,
	`last_pushed_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`target_id`) REFERENCES `calendar_targets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_links_item_idx` ON `calendar_links` (`target_id`,`kind`,`item_id`,`instance_key`);--> statement-breakpoint
CREATE INDEX `calendar_links_ref_idx` ON `calendar_links` (`target_id`,`ref`);--> statement-breakpoint
CREATE TABLE `calendar_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`provider` text NOT NULL,
	`remote_calendar_id` text NOT NULL,
	`name` text NOT NULL,
	`level` text NOT NULL,
	`user_id` text,
	`enabled` integer DEFAULT true NOT NULL,
	`config_json` text NOT NULL,
	`capabilities_json` text,
	`status` text DEFAULT 'unknown' NOT NULL,
	`last_error` text,
	`last_ok_at` integer,
	`last_checked_at` integer,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`last_stats_json` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "calendar_targets_level_check" CHECK(("calendar_targets"."level" = 'household' AND "calendar_targets"."user_id" IS NULL) OR ("calendar_targets"."level" = 'user' AND "calendar_targets"."user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_targets_calendar_idx` ON `calendar_targets` (`provider`,`remote_calendar_id`);--> statement-breakpoint
CREATE INDEX `calendar_targets_user_idx` ON `calendar_targets` (`user_id`);