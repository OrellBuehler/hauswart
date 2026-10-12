-- The default cost book becomes an explicit flag instead of "the first book that is not archived", so that reordering
-- the books never changes where an entry without a book goes: the book that is the default today (the first one that is
-- not archived, by sort order) keeps being it. A vehicle can remember the book its fuel fills go to, and a payment can
-- carry the idempotency key of the request that recorded it.
ALTER TABLE `cost_books` ADD `is_default` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `cost_books_default_idx` ON `cost_books` (`is_default`) WHERE "cost_books"."is_default" = 1;--> statement-breakpoint
UPDATE `cost_books` SET `is_default` = 1 WHERE `id` = (SELECT `id` FROM `cost_books` WHERE `archived_at` IS NULL ORDER BY `sort_order`, `created_at`, `id` LIMIT 1);--> statement-breakpoint
ALTER TABLE `settlements` ADD `idempotency_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `settlements_idempotency_idx` ON `settlements` (`created_by`,`idempotency_key`) WHERE "settlements"."idempotency_key" is not null;--> statement-breakpoint
ALTER TABLE `vehicle_details` ADD `cost_book_id` text REFERENCES cost_books(id) ON UPDATE no action ON DELETE set null;
