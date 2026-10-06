CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'device' NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`qr_slug` text NOT NULL,
	`room_id` text,
	`category` text,
	`manufacturer` text,
	`model` text,
	`serial_number` text,
	`purchase_date` text,
	`installed_date` text,
	`warranty_until` text,
	`warranty_extended_until` text,
	`show_on_emergency` integer DEFAULT false NOT NULL,
	`notes` text,
	`archived_at` integer,
	`species` text,
	`light` text,
	`water_notes` text,
	`photo_attachment_id` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_slug_unique` ON `assets` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `assets_qr_slug_unique` ON `assets` (`qr_slug`);--> statement-breakpoint
CREATE INDEX `assets_room_id_idx` ON `assets` (`room_id`);--> statement-breakpoint
CREATE INDEX `assets_kind_idx` ON `assets` (`kind`);--> statement-breakpoint
CREATE TABLE `household` (
	`id` text PRIMARY KEY DEFAULT 'household' NOT NULL,
	`name` text DEFAULT 'Haushalt' NOT NULL,
	`timezone` text NOT NULL,
	`currency` text DEFAULT 'CHF' NOT NULL,
	`handover_date` text,
	`settings` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`kind` text NOT NULL,
	`task_id` text,
	`dedupe_key` text NOT NULL,
	`title_key` text NOT NULL,
	`params_json` text DEFAULT '{}' NOT NULL,
	`url` text,
	`read_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_dedupe_key_unique` ON `notifications` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_id`,`read_at`);--> statement-breakpoint
CREATE INDEX `notifications_created_at_idx` ON `notifications` ("created_at" desc);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`ha_area_id` text,
	`icon` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_slug_unique` ON `rooms` (`slug`);--> statement-breakpoint
CREATE TABLE `task_completions` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`completed_at` integer NOT NULL,
	`completed_date` text NOT NULL,
	`user_id` text,
	`source` text NOT NULL,
	`kind` text DEFAULT 'done' NOT NULL,
	`counter_value` real,
	`occurrence_key` text,
	`due_date_at_completion` text,
	`note` text,
	`idempotency_key` text,
	`revoked_at` integer,
	`revoked_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_completions_idempotency_key_unique` ON `task_completions` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `task_completions_task_idx` ON `task_completions` (`task_id`,"completed_at" desc);--> statement-breakpoint
CREATE INDEX `task_completions_completed_at_idx` ON `task_completions` ("completed_at" desc);--> statement-breakpoint
CREATE TABLE `task_prep_completions` (
	`id` text PRIMARY KEY NOT NULL,
	`prep_id` text NOT NULL,
	`occurrence_key` text NOT NULL,
	`user_id` text,
	`completed_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`prep_id`) REFERENCES `task_preparations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_prep_completions_unique` ON `task_prep_completions` (`prep_id`,`occurrence_key`);--> statement-breakpoint
CREATE TABLE `task_preparations` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`title` text NOT NULL,
	`kind` text DEFAULT 'generic' NOT NULL,
	`lead_days` integer,
	`lead_value` text,
	`part_id` text,
	`qty` integer DEFAULT 1 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_preparations_task_id_idx` ON `task_preparations` (`task_id`);--> statement-breakpoint
CREATE TABLE `task_state` (
	`task_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`due_date` text,
	`due_kind` text NOT NULL,
	`occurrence_key` text NOT NULL,
	`window_start` text,
	`progress_json` text,
	`estimate_json` text,
	`missed_count` integer DEFAULT 0 NOT NULL,
	`reasons_json` text DEFAULT '[]' NOT NULL,
	`current_assignee_user_id` text,
	`counter_baseline` real,
	`active_since` integer,
	`due_since` integer,
	`evaluated_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`current_assignee_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `task_state_status_idx` ON `task_state` (`status`);--> statement-breakpoint
CREATE INDEX `task_state_due_date_idx` ON `task_state` (`due_date`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description_md` text DEFAULT '' NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`effort_minutes` integer,
	`asset_id` text,
	`room_id` text,
	`trigger` text NOT NULL,
	`assign_mode` text DEFAULT 'none' NOT NULL,
	`assignee_user_id` text,
	`rotation_order` text DEFAULT '[]' NOT NULL,
	`rotation_strategy` text DEFAULT 'alternate' NOT NULL,
	`notify_mode` text DEFAULT 'assignee' NOT NULL,
	`grace_days` integer DEFAULT 0 NOT NULL,
	`due_soon_days` integer,
	`snoozed_until` text,
	`archived_at` integer,
	`source` text DEFAULT 'manual' NOT NULL,
	`external_source` text,
	`external_ref` text,
	`external_url` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assignee_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tasks_asset_id_idx` ON `tasks` (`asset_id`);--> statement-breakpoint
CREATE INDEX `tasks_room_id_idx` ON `tasks` (`room_id`);--> statement-breakpoint
CREATE INDEX `tasks_archived_at_idx` ON `tasks` (`archived_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_external_idx` ON `tasks` (`external_source`,`external_ref`);