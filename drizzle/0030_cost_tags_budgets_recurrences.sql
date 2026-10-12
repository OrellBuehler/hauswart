-- Cost tags (a label on entries), budgets (what a book or category may cost per month or year) and recurring costs (the template
-- of entries a scheduler books when an occurrence falls due). An entry remembers the recurring cost and the occurrence that booked it,
-- and the pair is unique, so a run books each occurrence once. SQLite adds a column with a reference only without a default, hence
-- the actions of that reference are written out by hand.
CREATE TABLE `cost_budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text,
	`category` text,
	`period` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `cost_books`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cost_budgets_scope" CHECK("cost_budgets"."book_id" is not null or "cost_budgets"."category" is not null),
	CONSTRAINT "cost_budgets_amount_positive" CHECK("cost_budgets"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cost_budgets_book_category_idx` ON `cost_budgets` (`book_id`,`category`,`period`) WHERE "cost_budgets"."book_id" is not null and "cost_budgets"."category" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `cost_budgets_book_idx` ON `cost_budgets` (`book_id`,`period`) WHERE "cost_budgets"."category" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `cost_budgets_category_idx` ON `cost_budgets` (`category`,`period`) WHERE "cost_budgets"."book_id" is null;--> statement-breakpoint
CREATE INDEX `cost_budgets_book_id_idx` ON `cost_budgets` (`book_id`);--> statement-breakpoint
CREATE TABLE `cost_entry_tags` (
	`entry_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`entry_id`, `tag_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `cost_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `cost_tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cost_entry_tags_tag_id_idx` ON `cost_entry_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `cost_recurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`title` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`category` text NOT NULL,
	`asset_id` text,
	`room_id` text,
	`payee` text,
	`notes` text,
	`paid_by_user_id` text,
	`split_mode` text DEFAULT 'ownership' NOT NULL,
	`shares_json` text,
	`participant_ids_json` text,
	`tag_ids_json` text DEFAULT '[]' NOT NULL,
	`counts_as_expense` integer DEFAULT true NOT NULL,
	`deductible` text DEFAULT 'unknown' NOT NULL,
	`frequency` text NOT NULL,
	`interval` integer DEFAULT 1 NOT NULL,
	`day_of_month` integer NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`next_date` text,
	`last_occurrence_date` text,
	`active` integer DEFAULT true NOT NULL,
	`last_error` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `cost_books`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`paid_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "cost_recurrences_day" CHECK("cost_recurrences"."day_of_month" >= 1 and "cost_recurrences"."day_of_month" <= 31),
	CONSTRAINT "cost_recurrences_interval" CHECK("cost_recurrences"."interval" >= 1 and "cost_recurrences"."interval" <= 12)
);
--> statement-breakpoint
CREATE INDEX `cost_recurrences_due_idx` ON `cost_recurrences` (`next_date`) WHERE "cost_recurrences"."active" = 1 and "cost_recurrences"."next_date" is not null;--> statement-breakpoint
CREATE INDEX `cost_recurrences_book_id_idx` ON `cost_recurrences` (`book_id`);--> statement-breakpoint
CREATE TABLE `cost_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT 'gray' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cost_tags_name_idx` ON `cost_tags` (lower("name"));--> statement-breakpoint
ALTER TABLE `cost_entries` ADD `recurrence_id` text REFERENCES cost_recurrences(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `cost_entries` ADD `recurrence_date` text;--> statement-breakpoint
CREATE UNIQUE INDEX `cost_entries_recurrence_idx` ON `cost_entries` (`recurrence_id`,`recurrence_date`) WHERE "cost_entries"."recurrence_id" is not null;