-- The receipt queue learns to be worked on by more than one client without booking a receipt twice: a task and a cost entry can
-- carry the idempotency key of the request that made them (a retried request returns the first one), a cost entry remembers the
-- task it was booked for, a task remembers who closed it and who opened it last (a soft lease), and its key stands for a digest of
-- what was uploaded. SQLite adds a column with a reference only without a default, hence the actions are written out by hand.
ALTER TABLE `ai_tasks` ADD `completed_by_user_id` text REFERENCES users(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `ai_tasks` ADD `idempotency_key` text;--> statement-breakpoint
ALTER TABLE `ai_tasks` ADD `idempotency_digest` text;--> statement-breakpoint
ALTER TABLE `ai_tasks` ADD `claimed_by_user_id` text REFERENCES users(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `ai_tasks` ADD `claimed_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `ai_tasks_idempotency_idx` ON `ai_tasks` (`created_by_user_id`,`idempotency_key`) WHERE "ai_tasks"."idempotency_key" is not null;--> statement-breakpoint
ALTER TABLE `cost_entries` ADD `idempotency_key` text;--> statement-breakpoint
ALTER TABLE `cost_entries` ADD `ai_task_id` text REFERENCES ai_tasks(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
CREATE UNIQUE INDEX `cost_entries_idempotency_idx` ON `cost_entries` (`created_by`,`idempotency_key`) WHERE "cost_entries"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX `cost_entries_ai_task_idx` ON `cost_entries` (`ai_task_id`) WHERE "cost_entries"."ai_task_id" is not null;
