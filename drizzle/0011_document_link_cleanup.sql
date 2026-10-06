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
