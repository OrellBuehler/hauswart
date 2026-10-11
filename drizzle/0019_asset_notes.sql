CREATE TABLE `asset_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolved_at` integer,
	`resolved_by` text,
	`service_log_id` text,
	`defect_id` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`service_log_id`) REFERENCES `service_log`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`defect_id`) REFERENCES `defects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `asset_notes_asset_status_idx` ON `asset_notes` (`asset_id`,`status`);--> statement-breakpoint
CREATE INDEX `asset_notes_service_log_id_idx` ON `asset_notes` (`service_log_id`);--> statement-breakpoint
CREATE INDEX `asset_notes_defect_id_idx` ON `asset_notes` (`defect_id`);