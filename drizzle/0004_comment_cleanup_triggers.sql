CREATE TRIGGER `comments_cleanup_task` AFTER DELETE ON `tasks` BEGIN
	DELETE FROM `comments` WHERE `entity_type` = 'task' AND `entity_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `comments_cleanup_defect` AFTER DELETE ON `defects` BEGIN
	DELETE FROM `comments` WHERE `entity_type` = 'defect' AND `entity_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `comments_cleanup_asset` AFTER DELETE ON `assets` BEGIN
	DELETE FROM `comments` WHERE `entity_type` = 'asset' AND `entity_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `comments_cleanup_room` AFTER DELETE ON `rooms` BEGIN
	DELETE FROM `comments` WHERE `entity_type` = 'room' AND `entity_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `comments_cleanup_part` AFTER DELETE ON `parts` BEGIN
	DELETE FROM `comments` WHERE `entity_type` = 'part' AND `entity_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `comments_cleanup_contact` AFTER DELETE ON `contacts` BEGIN
	DELETE FROM `comments` WHERE `entity_type` = 'contact' AND `entity_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `comments_cleanup_service_log` AFTER DELETE ON `service_log` BEGIN
	DELETE FROM `comments` WHERE `entity_type` = 'service_log' AND `entity_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `comments_cleanup_asset_hint` AFTER DELETE ON `asset_hints` BEGIN
	DELETE FROM `comments` WHERE `entity_type` = 'asset_hint' AND `entity_id` = OLD.`id`;
END;
