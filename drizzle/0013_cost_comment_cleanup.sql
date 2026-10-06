CREATE TRIGGER `comments_cleanup_cost` AFTER DELETE ON `cost_entries` BEGIN
	DELETE FROM `comments` WHERE `entity_type` = 'cost' AND `entity_id` = OLD.`id`;
END;
