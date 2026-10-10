CREATE TABLE `tire_set_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tire_set_id` text NOT NULL,
	`date` text NOT NULL,
	`kind` text NOT NULL,
	`odometer` real,
	`tread_depth_mm` real,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`tire_set_id`) REFERENCES `tire_sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tire_set_events_set_idx` ON `tire_set_events` (`tire_set_id`,`date`);--> statement-breakpoint
CREATE TABLE `tire_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`season` text NOT NULL,
	`brand` text,
	`model` text,
	`size` text,
	`dot` text,
	`tread_depth_mm` real,
	`tread_measured_on` text,
	`storage_location` text,
	`storage_contact_id` text,
	`mounted` integer DEFAULT false NOT NULL,
	`purchased_on` text,
	`retired_at` integer,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`storage_contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tire_sets_asset_idx` ON `tire_sets` (`asset_id`);--> statement-breakpoint
CREATE INDEX `tire_sets_storage_contact_idx` ON `tire_sets` (`storage_contact_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tire_sets_mounted_idx` ON `tire_sets` (`asset_id`) WHERE "tire_sets"."mounted" = 1;