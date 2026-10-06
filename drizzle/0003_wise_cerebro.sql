CREATE TABLE `asset_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_contacts_unique` ON `asset_contacts` (`asset_id`,`contact_id`,`role`);--> statement-breakpoint
CREATE INDEX `asset_contacts_contact_id_idx` ON `asset_contacts` (`contact_id`);--> statement-breakpoint
CREATE TABLE `asset_hints` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`title` text NOT NULL,
	`body_md` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'tip' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`guest_visible` integer DEFAULT false NOT NULL,
	`task_id` text,
	`reaction` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `asset_hints_asset_idx` ON `asset_hints` (`asset_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `asset_hints_task_id_idx` ON `asset_hints` (`task_id`);--> statement-breakpoint
CREATE TABLE `asset_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`part_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_parts_unique` ON `asset_parts` (`asset_id`,`part_id`);--> statement-breakpoint
CREATE INDEX `asset_parts_part_id_idx` ON `asset_parts` (`part_id`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`user_id` text,
	`body_md` text NOT NULL,
	`edited_at` integer,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `comments_entity_idx` ON `comments` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`name` text NOT NULL,
	`company` text,
	`phone` text,
	`email` text,
	`url` text,
	`address` text,
	`notes` text,
	`emergency` integer DEFAULT false NOT NULL,
	`guest_visible` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`external_source` text,
	`external_ref` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `contacts_kind_idx` ON `contacts` (`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_external_idx` ON `contacts` (`external_source`,`external_ref`);--> statement-breakpoint
CREATE TABLE `defect_events` (
	`id` text PRIMARY KEY NOT NULL,
	`defect_id` text NOT NULL,
	`at` integer NOT NULL,
	`user_id` text,
	`type` text NOT NULL,
	`from_status` text,
	`to_status` text,
	`body_md` text DEFAULT '' NOT NULL,
	`external_ref` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`defect_id`) REFERENCES `defects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `defect_events_defect_idx` ON `defect_events` (`defect_id`,`at`);--> statement-breakpoint
CREATE TABLE `defects` (
	`id` text PRIMARY KEY NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`description_md` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`severity` text DEFAULT 'medium' NOT NULL,
	`room_id` text,
	`asset_id` text,
	`location_detail` text,
	`discovered_on` text NOT NULL,
	`reported_on` text,
	`responsible_contact_id` text,
	`deadline_date` text,
	`deadline_source` text DEFAULT 'manual' NOT NULL,
	`fixed_on` text,
	`resolution_md` text DEFAULT '' NOT NULL,
	`cost_entry_id` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`responsible_contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `defects_number_unique` ON `defects` (`number`);--> statement-breakpoint
CREATE INDEX `defects_status_idx` ON `defects` (`status`);--> statement-breakpoint
CREATE INDEX `defects_room_id_idx` ON `defects` (`room_id`);--> statement-breakpoint
CREATE INDEX `defects_asset_id_idx` ON `defects` (`asset_id`);--> statement-breakpoint
CREATE INDEX `defects_deadline_idx` ON `defects` (`deadline_date`);--> statement-breakpoint
CREATE TABLE `part_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`part_id` text NOT NULL,
	`delta` integer NOT NULL,
	`reason` text NOT NULL,
	`user_id` text,
	`completion_id` text,
	`note` text,
	`at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`completion_id`) REFERENCES `task_completions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `part_movements_part_idx` ON `part_movements` (`part_id`,"at" desc);--> statement-breakpoint
CREATE INDEX `part_movements_completion_id_idx` ON `part_movements` (`completion_id`);--> statement-breakpoint
CREATE TABLE `parts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`part_number` text,
	`supplier` text,
	`shop_url` text,
	`unit_price_minor` integer,
	`currency` text DEFAULT 'CHF' NOT NULL,
	`stock_count` integer DEFAULT 0 NOT NULL,
	`min_stock` integer DEFAULT 0 NOT NULL,
	`reorder_qty` integer DEFAULT 1 NOT NULL,
	`lead_time_days` integer DEFAULT 14 NOT NULL,
	`ordered_at` integer,
	`ordered_qty` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`archived_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `parts_archived_at_idx` ON `parts` (`archived_at`);--> statement-breakpoint
CREATE TABLE `service_log` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`date` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`description_md` text DEFAULT '' NOT NULL,
	`contact_id` text,
	`completion_id` text,
	`cost_minor` integer,
	`currency` text,
	`cost_entry_id` text,
	`performed_by` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`completion_id`) REFERENCES `task_completions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `service_log_asset_idx` ON `service_log` (`asset_id`,"date" desc);--> statement-breakpoint
CREATE INDEX `service_log_date_idx` ON `service_log` ("date" desc);--> statement-breakpoint
CREATE UNIQUE INDEX `service_log_completion_idx` ON `service_log` (`completion_id`);--> statement-breakpoint
CREATE TABLE `task_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`part_id` text NOT NULL,
	`qty` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_parts_unique` ON `task_parts` (`task_id`,`part_id`);--> statement-breakpoint
CREATE INDEX `task_parts_part_id_idx` ON `task_parts` (`part_id`);