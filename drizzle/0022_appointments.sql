CREATE TABLE `appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`location` text,
	`all_day` integer DEFAULT false NOT NULL,
	`starts_at` integer,
	`ends_at` integer,
	`start_date` text,
	`end_date` text,
	`task_id` text,
	`occurrence_key` text,
	`asset_id` text,
	`contact_id` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "appointments_when_check" CHECK(("appointments"."all_day" = 1 AND "appointments"."start_date" IS NOT NULL AND "appointments"."end_date" IS NOT NULL AND "appointments"."end_date" >= "appointments"."start_date" AND "appointments"."starts_at" IS NULL AND "appointments"."ends_at" IS NULL) OR ("appointments"."all_day" = 0 AND "appointments"."starts_at" IS NOT NULL AND "appointments"."ends_at" IS NOT NULL AND "appointments"."ends_at" > "appointments"."starts_at" AND "appointments"."start_date" IS NULL AND "appointments"."end_date" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `appointments_task_status_idx` ON `appointments` (`task_id`,`status`);--> statement-breakpoint
CREATE INDEX `appointments_asset_idx` ON `appointments` (`asset_id`);--> statement-breakpoint
CREATE INDEX `appointments_contact_idx` ON `appointments` (`contact_id`);--> statement-breakpoint
CREATE INDEX `appointments_starts_at_idx` ON `appointments` (`starts_at`);--> statement-breakpoint
CREATE INDEX `appointments_start_date_idx` ON `appointments` (`start_date`);