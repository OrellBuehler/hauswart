-- Cost books and settlements. Every cost entry now belongs to a book, so `cost_entries` gains a NOT NULL
-- `book_id` that points at a book. SQLite cannot add such a column to a table that has rows, so the table is
-- rebuilt (create, copy, drop, rename) after the default books exist; every earlier entry goes to "Wohnung".
-- The rebuild runs with foreign keys on inside the migrator's transaction (PRAGMA foreign_keys is a no-op there),
-- and dropping the old table would then cascade-delete the frozen shares and null the fuel log links; both are
-- set aside first and put back afterwards. The delete triggers of the table go with it and are created again.
CREATE TABLE `cost_books` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`icon` text,
	`default_split_mode` text DEFAULT 'ownership' NOT NULL,
	`tax_relevant` integer DEFAULT false NOT NULL,
	`archived_at` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cost_books_slug_idx` ON `cost_books` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `cost_books_name_idx` ON `cost_books` (lower("name"));--> statement-breakpoint
CREATE INDEX `cost_books_sort_idx` ON `cost_books` (`archived_at`,`sort_order`);--> statement-breakpoint
INSERT INTO `cost_books` (`id`, `name`, `slug`, `icon`, `default_split_mode`, `tax_relevant`, `sort_order`) VALUES
	(lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))), 'Wohnung', 'wohnung', 'house', 'ownership', 1, 0),
	(lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))), 'Haushalt', 'haushalt', 'shopping-basket', 'equal', 0, 1),
	(lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))), 'Auto', 'auto', 'car', 'equal', 0, 2);--> statement-breakpoint
CREATE TABLE `settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text,
	`from_user_id` text NOT NULL,
	`to_user_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`date` text NOT NULL,
	`note` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `cost_books`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`from_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`to_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "settlements_amount_positive" CHECK("settlements"."amount_minor" > 0),
	CONSTRAINT "settlements_two_people" CHECK("settlements"."from_user_id" <> "settlements"."to_user_id")
);
--> statement-breakpoint
CREATE INDEX `settlements_date_idx` ON `settlements` ("date" desc);--> statement-breakpoint
CREATE INDEX `settlements_book_id_idx` ON `settlements` (`book_id`);--> statement-breakpoint
CREATE INDEX `settlements_from_user_idx` ON `settlements` (`from_user_id`);--> statement-breakpoint
CREATE INDEX `settlements_to_user_idx` ON `settlements` (`to_user_id`);--> statement-breakpoint
CREATE TABLE `__stash_cost_entry_shares` AS SELECT `entry_id`, `user_id`, `share_bps` FROM `cost_entry_shares`;--> statement-breakpoint
CREATE TABLE `__stash_fuel_log_costs` AS SELECT `id`, `cost_entry_id` FROM `fuel_logs` WHERE `cost_entry_id` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_cost_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
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
	FOREIGN KEY (`book_id`) REFERENCES `cost_books`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`defect_id`) REFERENCES `defects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`service_log_id`) REFERENCES `service_log`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`paid_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`provider_connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_cost_entries`(`id`, `book_id`, `date`, `title`, `amount_minor`, `currency`, `category`, `asset_id`, `room_id`, `defect_id`, `service_log_id`, `payee`, `notes`, `paid_by_user_id`, `split_mode`, `counts_as_expense`, `deductible`, `source`, `provider_connection_id`, `provider_ref`, `provider_url`, `provider_link_id`, `link_synced_at`, `created_by`, `created_at`, `updated_at`) SELECT `id`, (SELECT `id` FROM `cost_books` WHERE `slug` = 'wohnung'), `date`, `title`, `amount_minor`, `currency`, `category`, `asset_id`, `room_id`, `defect_id`, `service_log_id`, `payee`, `notes`, `paid_by_user_id`, `split_mode`, `counts_as_expense`, `deductible`, `source`, `provider_connection_id`, `provider_ref`, `provider_url`, `provider_link_id`, `link_synced_at`, `created_by`, `created_at`, `updated_at` FROM `cost_entries`;--> statement-breakpoint
DROP TABLE `cost_entries`;--> statement-breakpoint
ALTER TABLE `__new_cost_entries` RENAME TO `cost_entries`;--> statement-breakpoint
CREATE INDEX `cost_entries_date_idx` ON `cost_entries` ("date" desc);--> statement-breakpoint
CREATE INDEX `cost_entries_book_id_idx` ON `cost_entries` (`book_id`);--> statement-breakpoint
CREATE INDEX `cost_entries_category_idx` ON `cost_entries` (`category`);--> statement-breakpoint
CREATE INDEX `cost_entries_asset_id_idx` ON `cost_entries` (`asset_id`);--> statement-breakpoint
CREATE INDEX `cost_entries_room_id_idx` ON `cost_entries` (`room_id`);--> statement-breakpoint
CREATE INDEX `cost_entries_defect_id_idx` ON `cost_entries` (`defect_id`);--> statement-breakpoint
CREATE INDEX `cost_entries_service_log_id_idx` ON `cost_entries` (`service_log_id`);--> statement-breakpoint
CREATE INDEX `cost_entries_paid_by_idx` ON `cost_entries` (`paid_by_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cost_entries_provider_idx` ON `cost_entries` (`provider_connection_id`,`provider_ref`) WHERE "cost_entries"."provider_connection_id" is not null and "cost_entries"."provider_ref" is not null;--> statement-breakpoint
CREATE TRIGGER `comments_cleanup_cost` AFTER DELETE ON `cost_entries` BEGIN
	DELETE FROM `comments` WHERE `entity_type` = 'cost' AND `entity_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `document_links_cleanup_cost` AFTER DELETE ON `cost_entries` BEGIN
	DELETE FROM `document_links` WHERE `owner_type` = 'cost' AND `owner_id` = OLD.`id`;
END;
--> statement-breakpoint
INSERT INTO `cost_entry_shares`(`entry_id`, `user_id`, `share_bps`) SELECT `entry_id`, `user_id`, `share_bps` FROM `__stash_cost_entry_shares`;--> statement-breakpoint
UPDATE `fuel_logs` SET `cost_entry_id` = (SELECT `s`.`cost_entry_id` FROM `__stash_fuel_log_costs` AS `s` WHERE `s`.`id` = `fuel_logs`.`id`) WHERE `id` IN (SELECT `id` FROM `__stash_fuel_log_costs`);--> statement-breakpoint
DROP TABLE `__stash_cost_entry_shares`;--> statement-breakpoint
DROP TABLE `__stash_fuel_log_costs`;
