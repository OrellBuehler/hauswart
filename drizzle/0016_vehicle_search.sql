-- A vehicle is found by its plate: the plate (written as entered and without spaces, hyphens and
-- dots, so "ZH 123456" is found by "ZH123456" too) joins the body of the asset's row in the search
-- index. The asset triggers of 0006 are replaced so an edit of the asset keeps the plate, and the
-- vehicle_details triggers rebuild the asset's row when the plate is saved or removed. Nothing but
-- the plate of vehicle_details is indexed: no VIN, no registration number, no notes.
DROP TRIGGER `search_assets_au`;
--> statement-breakpoint
CREATE TRIGGER `search_assets_au` AFTER UPDATE OF `name`, `manufacturer`, `model`, `serial_number`, `category`, `species`, `notes`, `archived_at` ON `assets` BEGIN
	DELETE FROM search_fts WHERE kind = 'asset' AND ref = OLD.id;
	INSERT INTO search_fts (kind, ref, title, body) SELECT 'asset', NEW.id, NEW.name, coalesce(NEW.manufacturer, '') || ' ' || coalesce(NEW.model, '') || ' ' || coalesce(NEW.serial_number, '') || ' ' || coalesce(NEW.category, '') || ' ' || coalesce(NEW.species, '') || ' ' || CASE WHEN instr(lower(coalesce(NEW.notes, '')), 'secret') > 0 AND instr(coalesce(NEW.notes, ''), ':::') > 0 THEN substr(coalesce(NEW.notes, ''), 1, instr(coalesce(NEW.notes, ''), ':::') - 1) ELSE coalesce(NEW.notes, '') END || ' ' || coalesce((SELECT plate || ' ' || replace(replace(replace(plate, ' ', ''), '-', ''), '.', '') FROM vehicle_details WHERE asset_id = NEW.id AND plate IS NOT NULL), '') WHERE NEW.archived_at IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `search_vehicle_details_ai` AFTER INSERT ON `vehicle_details` BEGIN
	DELETE FROM search_fts WHERE kind = 'asset' AND ref = NEW.asset_id;
	INSERT INTO search_fts (kind, ref, title, body) SELECT 'asset', a.id, a.name, coalesce(a.manufacturer, '') || ' ' || coalesce(a.model, '') || ' ' || coalesce(a.serial_number, '') || ' ' || coalesce(a.category, '') || ' ' || coalesce(a.species, '') || ' ' || CASE WHEN instr(lower(coalesce(a.notes, '')), 'secret') > 0 AND instr(coalesce(a.notes, ''), ':::') > 0 THEN substr(coalesce(a.notes, ''), 1, instr(coalesce(a.notes, ''), ':::') - 1) ELSE coalesce(a.notes, '') END || ' ' || coalesce((SELECT plate || ' ' || replace(replace(replace(plate, ' ', ''), '-', ''), '.', '') FROM vehicle_details WHERE asset_id = a.id AND plate IS NOT NULL), '') FROM assets a WHERE a.id = NEW.asset_id AND a.archived_at IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `search_vehicle_details_au` AFTER UPDATE OF `plate` ON `vehicle_details` BEGIN
	DELETE FROM search_fts WHERE kind = 'asset' AND ref = NEW.asset_id;
	INSERT INTO search_fts (kind, ref, title, body) SELECT 'asset', a.id, a.name, coalesce(a.manufacturer, '') || ' ' || coalesce(a.model, '') || ' ' || coalesce(a.serial_number, '') || ' ' || coalesce(a.category, '') || ' ' || coalesce(a.species, '') || ' ' || CASE WHEN instr(lower(coalesce(a.notes, '')), 'secret') > 0 AND instr(coalesce(a.notes, ''), ':::') > 0 THEN substr(coalesce(a.notes, ''), 1, instr(coalesce(a.notes, ''), ':::') - 1) ELSE coalesce(a.notes, '') END || ' ' || coalesce((SELECT plate || ' ' || replace(replace(replace(plate, ' ', ''), '-', ''), '.', '') FROM vehicle_details WHERE asset_id = a.id AND plate IS NOT NULL), '') FROM assets a WHERE a.id = NEW.asset_id AND a.archived_at IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `search_vehicle_details_ad` AFTER DELETE ON `vehicle_details` BEGIN
	DELETE FROM search_fts WHERE kind = 'asset' AND ref = OLD.asset_id;
	INSERT INTO search_fts (kind, ref, title, body) SELECT 'asset', a.id, a.name, coalesce(a.manufacturer, '') || ' ' || coalesce(a.model, '') || ' ' || coalesce(a.serial_number, '') || ' ' || coalesce(a.category, '') || ' ' || coalesce(a.species, '') || ' ' || CASE WHEN instr(lower(coalesce(a.notes, '')), 'secret') > 0 AND instr(coalesce(a.notes, ''), ':::') > 0 THEN substr(coalesce(a.notes, ''), 1, instr(coalesce(a.notes, ''), ':::') - 1) ELSE coalesce(a.notes, '') END || ' ' || coalesce((SELECT plate || ' ' || replace(replace(replace(plate, ' ', ''), '-', ''), '.', '') FROM vehicle_details WHERE asset_id = a.id AND plate IS NOT NULL), '') FROM assets a WHERE a.id = OLD.asset_id AND a.archived_at IS NULL;
END;
