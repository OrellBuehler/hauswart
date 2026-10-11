-- What goes with an insurance policy when it is deleted (comments and document links have no
-- foreign key to their owner), and its entry in the full-text index (see 0006_search_index: no
-- secret text enters the index, every free-text field is cut off at the first ':::' whenever it
-- mentions 'secret'; the policy number is searchable, the assistance phone is not).
CREATE TRIGGER `comments_cleanup_insurance_policy` AFTER DELETE ON `insurance_policies` BEGIN
	DELETE FROM `comments` WHERE `entity_type` = 'insurance_policy' AND `entity_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `document_links_cleanup_insurance_policy` AFTER DELETE ON `insurance_policies` BEGIN
	DELETE FROM `document_links` WHERE `owner_type` = 'insurance_policy' AND `owner_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `search_insurance_policies_ai` AFTER INSERT ON `insurance_policies` WHEN NEW.archived_at IS NULL BEGIN
	INSERT INTO search_fts (kind, ref, title, body) VALUES ('insurance_policy', NEW.id, NEW.title, coalesce(NEW.policy_number, '') || ' ' || CASE WHEN instr(lower(coalesce(NEW.notes, '')), 'secret') > 0 AND instr(coalesce(NEW.notes, ''), ':::') > 0 THEN substr(coalesce(NEW.notes, ''), 1, instr(coalesce(NEW.notes, ''), ':::') - 1) ELSE coalesce(NEW.notes, '') END);
END;
--> statement-breakpoint
CREATE TRIGGER `search_insurance_policies_au` AFTER UPDATE OF `title`, `policy_number`, `notes`, `archived_at` ON `insurance_policies` BEGIN
	DELETE FROM search_fts WHERE kind = 'insurance_policy' AND ref = OLD.id;
	INSERT INTO search_fts (kind, ref, title, body) SELECT 'insurance_policy', NEW.id, NEW.title, coalesce(NEW.policy_number, '') || ' ' || CASE WHEN instr(lower(coalesce(NEW.notes, '')), 'secret') > 0 AND instr(coalesce(NEW.notes, ''), ':::') > 0 THEN substr(coalesce(NEW.notes, ''), 1, instr(coalesce(NEW.notes, ''), ':::') - 1) ELSE coalesce(NEW.notes, '') END WHERE NEW.archived_at IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `search_insurance_policies_ad` AFTER DELETE ON `insurance_policies` BEGIN
	DELETE FROM search_fts WHERE kind = 'insurance_policy' AND ref = OLD.id;
END;
