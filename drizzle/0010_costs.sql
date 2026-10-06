CREATE TABLE `cost_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`title` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`category` text NOT NULL,
	`asset_id` text,
	`room_id` text,
	`defect_id` text,
	`service_log_id` text,
	`payee` text,
	`notes` text,
	`paid_by_user_id` text,
	`split_mode` text DEFAULT 'ownership' NOT NULL,
	`counts_as_expense` integer DEFAULT true NOT NULL,
	`deductible` text DEFAULT 'unknown' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`provider_connection_id` text,
	`provider_ref` text,
	`provider_url` text,
	`provider_link_id` text,
	`link_synced_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`defect_id`) REFERENCES `defects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`service_log_id`) REFERENCES `service_log`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`paid_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`provider_connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `cost_entries_date_idx` ON `cost_entries` ("date" desc);--> statement-breakpoint
CREATE INDEX `cost_entries_category_idx` ON `cost_entries` (`category`);--> statement-breakpoint
CREATE INDEX `cost_entries_asset_id_idx` ON `cost_entries` (`asset_id`);--> statement-breakpoint
CREATE INDEX `cost_entries_room_id_idx` ON `cost_entries` (`room_id`);--> statement-breakpoint
CREATE INDEX `cost_entries_defect_id_idx` ON `cost_entries` (`defect_id`);--> statement-breakpoint
CREATE INDEX `cost_entries_service_log_id_idx` ON `cost_entries` (`service_log_id`);--> statement-breakpoint
CREATE INDEX `cost_entries_paid_by_idx` ON `cost_entries` (`paid_by_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cost_entries_provider_idx` ON `cost_entries` (`provider_connection_id`,`provider_ref`) WHERE "cost_entries"."provider_connection_id" is not null and "cost_entries"."provider_ref" is not null;--> statement-breakpoint
CREATE TABLE `cost_entry_shares` (
	`entry_id` text NOT NULL,
	`user_id` text NOT NULL,
	`share_bps` integer NOT NULL,
	PRIMARY KEY(`entry_id`, `user_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `cost_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cost_entry_shares_user_id_idx` ON `cost_entry_shares` (`user_id`);--> statement-breakpoint
CREATE TABLE `cost_link_removals` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`link_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cost_link_removals_connection_idx` ON `cost_link_removals` (`connection_id`);--> statement-breakpoint
CREATE TABLE `finance_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`provider_ref` text NOT NULL,
	`payload_json` text NOT NULL,
	`bill_refs_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`accepted_entity_id` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_suggestions_ref_idx` ON `finance_suggestions` (`connection_id`,`kind`,`provider_ref`);--> statement-breakpoint
CREATE INDEX `finance_suggestions_user_idx` ON `finance_suggestions` (`user_id`,`status`,`kind`);--> statement-breakpoint
CREATE TABLE `finance_sync_state` (
	`connection_id` text PRIMARY KEY NOT NULL,
	`transactions_since` text,
	`bills_since` text,
	`transactions_scope` text,
	`bills_scope` text,
	`last_run_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
