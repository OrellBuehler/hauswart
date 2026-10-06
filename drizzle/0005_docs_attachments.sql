CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`sha256` text NOT NULL,
	`path` text NOT NULL,
	`thumb_path` text,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`filename` text NOT NULL,
	`caption` text,
	`guest_visible` integer DEFAULT false NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`uploaded_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `attachments_owner_idx` ON `attachments` (`owner_type`,`owner_id`);--> statement-breakpoint
CREATE INDEX `attachments_sha256_idx` ON `attachments` (`sha256`);--> statement-breakpoint
CREATE TABLE `doc_page_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`rev` integer NOT NULL,
	`title` text NOT NULL,
	`body_md` text NOT NULL,
	`user_id` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `doc_pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `doc_page_revisions_page_rev` ON `doc_page_revisions` (`page_id`,`rev`);--> statement-breakpoint
CREATE TABLE `doc_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`section` text DEFAULT 'general' NOT NULL,
	`asset_id` text,
	`room_id` text,
	`body_md` text DEFAULT '' NOT NULL,
	`rendered_html_member` text DEFAULT '' NOT NULL,
	`rendered_html_guest` text DEFAULT '' NOT NULL,
	`plain_text` text DEFAULT '' NOT NULL,
	`headings_json` text DEFAULT '{"member":[],"guest":[]}' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`guest_visible` integer DEFAULT false NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL,
	`updated_by` text,
	`archived_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `doc_pages_slug_unique` ON `doc_pages` (`slug`);--> statement-breakpoint
CREATE INDEX `doc_pages_asset_id_idx` ON `doc_pages` (`asset_id`);--> statement-breakpoint
CREATE INDEX `doc_pages_room_id_idx` ON `doc_pages` (`room_id`);--> statement-breakpoint
CREATE INDEX `doc_pages_section_idx` ON `doc_pages` (`section`);