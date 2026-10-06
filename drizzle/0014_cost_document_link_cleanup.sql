CREATE TRIGGER `document_links_cleanup_cost` AFTER DELETE ON `cost_entries` BEGIN
	DELETE FROM `document_links` WHERE `owner_type` = 'cost' AND `owner_id` = OLD.`id`;
END;
