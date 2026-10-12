-- The receipt queue (`ai_tasks`): receipts that wait for an assistant to book them, each with the file (an attachment of the owner type
-- `ai_task`, which needs no change here) and, once processed, the ids of the entries it became. Cost entries learn whether a person
-- still has to look at them (`review_needed`, with who reviewed them and when); the partial index serves the "to review" list and its count.
CREATE TABLE `ai_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`note` text,
	`created_by_user_id` text,
	`attachment_id` text,
	`book_id` text,
	`asset_id` text,
	`result_json` text,
	`dismiss_reason` text,
	`completed_at` integer,
	`completed_via` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`book_id`) REFERENCES `cost_books`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ai_tasks_status_idx` ON `ai_tasks` (`status`,"created_at" desc);--> statement-breakpoint
CREATE INDEX `ai_tasks_attachment_id_idx` ON `ai_tasks` (`attachment_id`);--> statement-breakpoint
ALTER TABLE `cost_entries` ADD `review_needed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `cost_entries` ADD `reviewed_at` integer;--> statement-breakpoint
ALTER TABLE `cost_entries` ADD `reviewed_by_user_id` text REFERENCES users(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
CREATE INDEX `cost_entries_review_idx` ON `cost_entries` (`review_needed`) WHERE "cost_entries"."review_needed" = 1;