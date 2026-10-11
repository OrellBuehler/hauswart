-- What goes with an appointment when it is deleted (comments have no foreign key to their owner;
-- its attachments are removed by the delete service), and its entry in the full-text index (see
-- 0006_search_index: no secret text enters the index, free text is cut off at the first ':::'
-- whenever it mentions 'secret'). Title, place and notes are searchable, whatever the status.
CREATE TRIGGER `comments_cleanup_appointment` AFTER DELETE ON `appointments` BEGIN
	DELETE FROM `comments` WHERE `entity_type` = 'appointment' AND `entity_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `search_appointments_ai` AFTER INSERT ON `appointments` BEGIN
	INSERT INTO search_fts (kind, ref, title, body) VALUES ('appointment', NEW.id, NEW.title, CASE WHEN instr(lower(coalesce(NEW.location, '')), 'secret') > 0 AND instr(coalesce(NEW.location, ''), ':::') > 0 THEN substr(coalesce(NEW.location, ''), 1, instr(coalesce(NEW.location, ''), ':::') - 1) ELSE coalesce(NEW.location, '') END || ' ' || CASE WHEN instr(lower(coalesce(NEW.notes, '')), 'secret') > 0 AND instr(coalesce(NEW.notes, ''), ':::') > 0 THEN substr(coalesce(NEW.notes, ''), 1, instr(coalesce(NEW.notes, ''), ':::') - 1) ELSE coalesce(NEW.notes, '') END);
END;
--> statement-breakpoint
CREATE TRIGGER `search_appointments_au` AFTER UPDATE OF `title`, `location`, `notes` ON `appointments` BEGIN
	DELETE FROM search_fts WHERE kind = 'appointment' AND ref = OLD.id;
	INSERT INTO search_fts (kind, ref, title, body) VALUES ('appointment', NEW.id, NEW.title, CASE WHEN instr(lower(coalesce(NEW.location, '')), 'secret') > 0 AND instr(coalesce(NEW.location, ''), ':::') > 0 THEN substr(coalesce(NEW.location, ''), 1, instr(coalesce(NEW.location, ''), ':::') - 1) ELSE coalesce(NEW.location, '') END || ' ' || CASE WHEN instr(lower(coalesce(NEW.notes, '')), 'secret') > 0 AND instr(coalesce(NEW.notes, ''), ':::') > 0 THEN substr(coalesce(NEW.notes, ''), 1, instr(coalesce(NEW.notes, ''), ':::') - 1) ELSE coalesce(NEW.notes, '') END);
END;
--> statement-breakpoint
CREATE TRIGGER `search_appointments_ad` AFTER DELETE ON `appointments` BEGIN
	DELETE FROM search_fts WHERE kind = 'appointment' AND ref = OLD.id;
END;
