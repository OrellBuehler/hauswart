CREATE TABLE `fuel_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`date` text NOT NULL,
	`odometer` real NOT NULL,
	`quantity` real NOT NULL,
	`unit` text DEFAULT 'l' NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`full_tank` integer DEFAULT true NOT NULL,
	`missed_previous` integer DEFAULT false NOT NULL,
	`station` text,
	`notes` text,
	`cost_entry_id` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cost_entry_id`) REFERENCES `cost_entries`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `fuel_logs_asset_idx` ON `fuel_logs` (`asset_id`,"date" desc);--> statement-breakpoint
CREATE INDEX `fuel_logs_cost_entry_idx` ON `fuel_logs` (`cost_entry_id`);