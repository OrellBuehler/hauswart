-- The steps that say how to do a task, in order, and where they come from (a page on the web or a page of a file in
-- hauswart, kept as JSON on the task). The pictures of a step are attachments of the owner type task_step, which have no
-- foreign key; the service removes them when a step or its task goes.
CREATE TABLE `task_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_steps_task_id_idx` ON `task_steps` (`task_id`,`position`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `steps_source` text;