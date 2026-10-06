CREATE TABLE `document_links` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`external_id` integer NOT NULL,
	`connection_id` text,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`role` text NOT NULL,
	`label` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_links_unique` ON `document_links` (`provider`,`external_id`,`owner_type`,`owner_id`,`role`);--> statement-breakpoint
CREATE INDEX `document_links_owner_idx` ON `document_links` (`owner_type`,`owner_id`);--> statement-breakpoint
CREATE INDEX `document_links_doc_idx` ON `document_links` (`provider`,`external_id`);--> statement-breakpoint
CREATE TABLE `document_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`connection_id` text NOT NULL,
	`user_id` text NOT NULL,
	`attachment_id` text NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`role` text NOT NULL,
	`label` text,
	`title` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`task_id` text,
	`external_id` integer,
	`link_id` text,
	`duplicate` integer DEFAULT false NOT NULL,
	`error_code` text,
	`warning` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `document_uploads_user_idx` ON `document_uploads` (`user_id`);--> statement-breakpoint
CREATE INDEX `document_uploads_attachment_idx` ON `document_uploads` (`connection_id`,`attachment_id`);--> statement-breakpoint
CREATE INDEX `document_uploads_status_idx` ON `document_uploads` (`status`);--> statement-breakpoint
CREATE TABLE `external_document_sync` (
	`connection_id` text PRIMARY KEY NOT NULL,
	`base_url` text NOT NULL,
	`scope_hash` text NOT NULL,
	`last_modified` text,
	`last_full_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `external_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`connection_id` text NOT NULL,
	`external_id` integer NOT NULL,
	`title` text NOT NULL,
	`created_date` text,
	`modified_at` text,
	`correspondent_id` integer,
	`correspondent_name` text,
	`tag_ids` text DEFAULT '[]' NOT NULL,
	`tag_names` text DEFAULT '[]' NOT NULL,
	`mime_type` text,
	`page_count` integer,
	`custom_fields_json` text DEFAULT '{"warrantyUntil":null,"warrantyExtendedUntil":null}' NOT NULL,
	`note_count` integer DEFAULT 0 NOT NULL,
	`owner_visible` integer DEFAULT true NOT NULL,
	`synced_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_documents_conn_ext_idx` ON `external_documents` (`connection_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `external_documents_provider_ext_idx` ON `external_documents` (`provider`,`external_id`);--> statement-breakpoint
ALTER TABLE `assets` ADD `warranty_source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
CREATE TRIGGER `document_links_cleanup_asset` AFTER DELETE ON `assets` BEGIN
	DELETE FROM `document_links` WHERE `owner_type` = 'asset' AND `owner_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `document_links_cleanup_room` AFTER DELETE ON `rooms` BEGIN
	DELETE FROM `document_links` WHERE `owner_type` = 'room' AND `owner_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `document_links_cleanup_page` AFTER DELETE ON `doc_pages` BEGIN
	DELETE FROM `document_links` WHERE `owner_type` = 'page' AND `owner_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `document_links_cleanup_task` AFTER DELETE ON `tasks` BEGIN
	DELETE FROM `document_links` WHERE `owner_type` = 'task' AND `owner_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `document_links_cleanup_defect` AFTER DELETE ON `defects` BEGIN
	DELETE FROM `document_links` WHERE `owner_type` = 'defect' AND `owner_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `document_links_cleanup_service_log` AFTER DELETE ON `service_log` BEGIN
	DELETE FROM `document_links` WHERE `owner_type` = 'service_log' AND `owner_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `document_links_cleanup_part` AFTER DELETE ON `parts` BEGIN
	DELETE FROM `document_links` WHERE `owner_type` = 'part' AND `owner_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `document_links_cleanup_contact` AFTER DELETE ON `contacts` BEGIN
	DELETE FROM `document_links` WHERE `owner_type` = 'contact' AND `owner_id` = OLD.`id`;
END;
