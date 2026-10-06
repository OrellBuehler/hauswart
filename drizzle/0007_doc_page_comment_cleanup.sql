CREATE TRIGGER `comments_cleanup_doc_page` AFTER DELETE ON `doc_pages` BEGIN
	DELETE FROM `comments` WHERE `entity_type` = 'doc_page' AND `entity_id` = OLD.`id`;
END;
