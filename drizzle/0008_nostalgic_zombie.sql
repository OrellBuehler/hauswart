CREATE TABLE `connections` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`user_id` text,
	`base_url` text NOT NULL,
	`token_enc` text NOT NULL,
	`allow_insecure_tls` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'unknown' NOT NULL,
	`last_error` text,
	`last_ok_at` integer,
	`last_checked_at` integer,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connections_kind_user_idx` ON `connections` (`kind`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `connections_household_kind_idx` ON `connections` (`kind`) WHERE "connections"."user_id" is null;--> statement-breakpoint
CREATE TABLE `external_dates` (
	`key` text NOT NULL,
	`date` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`key`, `date`, `title`)
);
--> statement-breakpoint
CREATE TABLE `notification_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`notification_id` text NOT NULL,
	`user_id` text NOT NULL,
	`channel` text NOT NULL,
	`target` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`error_code` text,
	`attempts` integer DEFAULT 1 NOT NULL,
	`occurrence_key` text,
	`sent_at` integer NOT NULL,
	`action_token_hash` text,
	`action_expires_at` integer,
	`action_used_at` integer,
	`action_completion_id` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notification_deliveries_notification_idx` ON `notification_deliveries` (`notification_id`);--> statement-breakpoint
CREATE INDEX `notification_deliveries_token_idx` ON `notification_deliveries` (`action_token_hash`);--> statement-breakpoint
CREATE INDEX `notification_deliveries_status_idx` ON `notification_deliveries` (`status`,`sent_at`);--> statement-breakpoint
CREATE TABLE `notification_prefs` (
	`user_id` text PRIMARY KEY NOT NULL,
	`push_enabled` integer DEFAULT true NOT NULL,
	`quiet_start` text,
	`quiet_end` text,
	`push_stages` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notification_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`channel` text NOT NULL,
	`target` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_targets_unique` ON `notification_targets` (`user_id`,`channel`,`target`);--> statement-breakpoint
CREATE TABLE `pending_reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`hint_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`transition_key` text NOT NULL,
	`fire_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`hint_id`) REFERENCES `asset_hints`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pending_reactions_transition_idx` ON `pending_reactions` (`hint_id`,`transition_key`);--> statement-breakpoint
CREATE INDEX `pending_reactions_due_idx` ON `pending_reactions` (`status`,`fire_at`);--> statement-breakpoint
CREATE TABLE `signal_samples` (
	`key` text NOT NULL,
	`at` integer NOT NULL,
	`value` real NOT NULL,
	PRIMARY KEY(`key`, `at`)
);
--> statement-breakpoint
CREATE TABLE `signals` (
	`key` text PRIMARY KEY NOT NULL,
	`numeric` real,
	`text` text,
	`unit` text,
	`changed_at` integer NOT NULL,
	`seen_at` integer NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `assets` ADD `external_source` text;--> statement-breakpoint
ALTER TABLE `assets` ADD `external_ref` text;--> statement-breakpoint
CREATE UNIQUE INDEX `assets_external_idx` ON `assets` (`external_source`,`external_ref`);