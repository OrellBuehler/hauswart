-- Full-text index for GET /search. One row per searchable entity: kind + ref identify it, title
-- and body are indexed. Maintained by the triggers below, so every writer is covered.
-- Secrets never enter the index: pages index plain_text (secret blocks already removed); the
-- free-text markdown fields of assets, rooms and tasks are cut off at the first ':::' whenever
-- the text mentions 'secret' anywhere (fail closed, see markdown.ts splitBlocks).
CREATE VIRTUAL TABLE `search_fts` USING fts5(
	kind UNINDEXED,
	ref UNINDEXED,
	title,
	body,
	tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `search_pages_ai` AFTER INSERT ON `doc_pages` WHEN NEW.archived_at IS NULL BEGIN
	INSERT INTO search_fts (kind, ref, title, body) VALUES ('page', NEW.id, NEW.title, coalesce(NEW.plain_text, ''));
END;
--> statement-breakpoint
CREATE TRIGGER `search_pages_au` AFTER UPDATE OF `title`, `plain_text`, `archived_at` ON `doc_pages` BEGIN
	DELETE FROM search_fts WHERE kind = 'page' AND ref = OLD.id;
	INSERT INTO search_fts (kind, ref, title, body) SELECT 'page', NEW.id, NEW.title, coalesce(NEW.plain_text, '') WHERE NEW.archived_at IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `search_pages_ad` AFTER DELETE ON `doc_pages` BEGIN
	DELETE FROM search_fts WHERE kind = 'page' AND ref = OLD.id;
END;
--> statement-breakpoint
INSERT INTO search_fts (kind, ref, title, body) SELECT 'page', id, title, coalesce(plain_text, '') FROM `doc_pages` WHERE archived_at IS NULL;
--> statement-breakpoint
CREATE TRIGGER `search_assets_ai` AFTER INSERT ON `assets` WHEN NEW.archived_at IS NULL BEGIN
	INSERT INTO search_fts (kind, ref, title, body) VALUES ('asset', NEW.id, NEW.name, coalesce(NEW.manufacturer, '') || ' ' || coalesce(NEW.model, '') || ' ' || coalesce(NEW.serial_number, '') || ' ' || coalesce(NEW.category, '') || ' ' || coalesce(NEW.species, '') || ' ' || CASE WHEN instr(lower(coalesce(NEW.notes, '')), 'secret') > 0 AND instr(coalesce(NEW.notes, ''), ':::') > 0 THEN substr(coalesce(NEW.notes, ''), 1, instr(coalesce(NEW.notes, ''), ':::') - 1) ELSE coalesce(NEW.notes, '') END);
END;
--> statement-breakpoint
CREATE TRIGGER `search_assets_au` AFTER UPDATE OF `name`, `manufacturer`, `model`, `serial_number`, `category`, `species`, `notes`, `archived_at` ON `assets` BEGIN
	DELETE FROM search_fts WHERE kind = 'asset' AND ref = OLD.id;
	INSERT INTO search_fts (kind, ref, title, body) SELECT 'asset', NEW.id, NEW.name, coalesce(NEW.manufacturer, '') || ' ' || coalesce(NEW.model, '') || ' ' || coalesce(NEW.serial_number, '') || ' ' || coalesce(NEW.category, '') || ' ' || coalesce(NEW.species, '') || ' ' || CASE WHEN instr(lower(coalesce(NEW.notes, '')), 'secret') > 0 AND instr(coalesce(NEW.notes, ''), ':::') > 0 THEN substr(coalesce(NEW.notes, ''), 1, instr(coalesce(NEW.notes, ''), ':::') - 1) ELSE coalesce(NEW.notes, '') END WHERE NEW.archived_at IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `search_assets_ad` AFTER DELETE ON `assets` BEGIN
	DELETE FROM search_fts WHERE kind = 'asset' AND ref = OLD.id;
END;
--> statement-breakpoint
INSERT INTO search_fts (kind, ref, title, body) SELECT 'asset', id, name, coalesce(manufacturer, '') || ' ' || coalesce(model, '') || ' ' || coalesce(serial_number, '') || ' ' || coalesce(category, '') || ' ' || coalesce(species, '') || ' ' || CASE WHEN instr(lower(coalesce(notes, '')), 'secret') > 0 AND instr(coalesce(notes, ''), ':::') > 0 THEN substr(coalesce(notes, ''), 1, instr(coalesce(notes, ''), ':::') - 1) ELSE coalesce(notes, '') END FROM `assets` WHERE archived_at IS NULL;
--> statement-breakpoint
CREATE TRIGGER `search_rooms_ai` AFTER INSERT ON `rooms` BEGIN
	INSERT INTO search_fts (kind, ref, title, body) VALUES ('room', NEW.id, NEW.name, CASE WHEN instr(lower(coalesce(NEW.notes, '')), 'secret') > 0 AND instr(coalesce(NEW.notes, ''), ':::') > 0 THEN substr(coalesce(NEW.notes, ''), 1, instr(coalesce(NEW.notes, ''), ':::') - 1) ELSE coalesce(NEW.notes, '') END);
END;
--> statement-breakpoint
CREATE TRIGGER `search_rooms_au` AFTER UPDATE OF `name`, `notes` ON `rooms` BEGIN
	DELETE FROM search_fts WHERE kind = 'room' AND ref = OLD.id;
	INSERT INTO search_fts (kind, ref, title, body) SELECT 'room', NEW.id, NEW.name, CASE WHEN instr(lower(coalesce(NEW.notes, '')), 'secret') > 0 AND instr(coalesce(NEW.notes, ''), ':::') > 0 THEN substr(coalesce(NEW.notes, ''), 1, instr(coalesce(NEW.notes, ''), ':::') - 1) ELSE coalesce(NEW.notes, '') END;
END;
--> statement-breakpoint
CREATE TRIGGER `search_rooms_ad` AFTER DELETE ON `rooms` BEGIN
	DELETE FROM search_fts WHERE kind = 'room' AND ref = OLD.id;
END;
--> statement-breakpoint
INSERT INTO search_fts (kind, ref, title, body) SELECT 'room', id, name, CASE WHEN instr(lower(coalesce(notes, '')), 'secret') > 0 AND instr(coalesce(notes, ''), ':::') > 0 THEN substr(coalesce(notes, ''), 1, instr(coalesce(notes, ''), ':::') - 1) ELSE coalesce(notes, '') END FROM `rooms`;
--> statement-breakpoint
CREATE TRIGGER `search_tasks_ai` AFTER INSERT ON `tasks` WHEN NEW.archived_at IS NULL BEGIN
	INSERT INTO search_fts (kind, ref, title, body) VALUES ('task', NEW.id, NEW.title, CASE WHEN instr(lower(coalesce(NEW.description_md, '')), 'secret') > 0 AND instr(coalesce(NEW.description_md, ''), ':::') > 0 THEN substr(coalesce(NEW.description_md, ''), 1, instr(coalesce(NEW.description_md, ''), ':::') - 1) ELSE coalesce(NEW.description_md, '') END);
END;
--> statement-breakpoint
CREATE TRIGGER `search_tasks_au` AFTER UPDATE OF `title`, `description_md`, `archived_at` ON `tasks` BEGIN
	DELETE FROM search_fts WHERE kind = 'task' AND ref = OLD.id;
	INSERT INTO search_fts (kind, ref, title, body) SELECT 'task', NEW.id, NEW.title, CASE WHEN instr(lower(coalesce(NEW.description_md, '')), 'secret') > 0 AND instr(coalesce(NEW.description_md, ''), ':::') > 0 THEN substr(coalesce(NEW.description_md, ''), 1, instr(coalesce(NEW.description_md, ''), ':::') - 1) ELSE coalesce(NEW.description_md, '') END WHERE NEW.archived_at IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `search_tasks_ad` AFTER DELETE ON `tasks` BEGIN
	DELETE FROM search_fts WHERE kind = 'task' AND ref = OLD.id;
END;
--> statement-breakpoint
INSERT INTO search_fts (kind, ref, title, body) SELECT 'task', id, title, CASE WHEN instr(lower(coalesce(description_md, '')), 'secret') > 0 AND instr(coalesce(description_md, ''), ':::') > 0 THEN substr(coalesce(description_md, ''), 1, instr(coalesce(description_md, ''), ':::') - 1) ELSE coalesce(description_md, '') END FROM `tasks` WHERE archived_at IS NULL;
