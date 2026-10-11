CREATE TABLE `odometer_readings` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`date` text NOT NULL,
	`value` real NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`source_id` text,
	`note` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `odometer_readings_asset_idx` ON `odometer_readings` (`asset_id`,"date" desc);--> statement-breakpoint
CREATE UNIQUE INDEX `odometer_readings_source_idx` ON `odometer_readings` (`source`,`source_id`) WHERE "odometer_readings"."source_id" is not null;--> statement-breakpoint
CREATE TABLE `vehicle_details` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`plate` text,
	`vin` text,
	`registration_number` text,
	`first_registration` text,
	`fuel_type` text,
	`tire_size_summer` text,
	`tire_size_winter` text,
	`location` text,
	`odometer_unit` text DEFAULT 'km' NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `service_log` ADD `odometer` real;