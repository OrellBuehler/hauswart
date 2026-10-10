CREATE TABLE `insurance_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`type` text DEFAULT 'other' NOT NULL,
	`insurer_contact_id` text,
	`policy_number` text,
	`premium_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`premium_period` text DEFAULT 'annual' NOT NULL,
	`deductible_minor` integer,
	`start_date` text NOT NULL,
	`end_date` text,
	`renewal` text DEFAULT 'auto' NOT NULL,
	`cancellation_notice_months` integer,
	`assistance_phone` text,
	`show_on_emergency` integer DEFAULT false NOT NULL,
	`notes` text,
	`archived_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`insurer_contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `insurance_policies_type_idx` ON `insurance_policies` (`type`);--> statement-breakpoint
CREATE INDEX `insurance_policies_archived_at_idx` ON `insurance_policies` (`archived_at`);--> statement-breakpoint
CREATE INDEX `insurance_policies_insurer_idx` ON `insurance_policies` (`insurer_contact_id`);--> statement-breakpoint
CREATE TABLE `insurance_policy_assets` (
	`policy_id` text NOT NULL,
	`asset_id` text NOT NULL,
	PRIMARY KEY(`policy_id`, `asset_id`),
	FOREIGN KEY (`policy_id`) REFERENCES `insurance_policies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `insurance_policy_assets_asset_id_idx` ON `insurance_policy_assets` (`asset_id`);