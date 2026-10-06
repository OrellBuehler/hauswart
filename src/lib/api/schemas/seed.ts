import { z } from "zod";
import { triggerSchema } from "../../tasks/engine/types";
import { createAssetRequestSchema } from "./assets";
import { createRoomRequestSchema } from "./rooms";
import {
  createPreparationRequestSchema,
  createTaskRequestSchema,
  notifyModeSchema,
  rotationStrategySchema,
} from "./tasks";
import { dateSchema, slugSchema } from "./common";

/**
 * A seed file describes a household's rooms, assets and tasks. The importer
 * (`scripts/seed.ts`) creates them through the REST API and finds them again
 * by `key`, so importing twice changes nothing: rooms and assets use the key
 * as their slug, tasks store it as `externalSource: "seed"`, `externalRef: key`.
 */
const keySchema = slugSchema;

export const seedRoomSchema = z.strictObject({
  key: keySchema,
  name: createRoomRequestSchema.shape.name,
  haAreaId: createRoomRequestSchema.shape.haAreaId,
  icon: createRoomRequestSchema.shape.icon,
  sortOrder: createRoomRequestSchema.shape.sortOrder,
  notes: createRoomRequestSchema.shape.notes,
});

const assetShape = createAssetRequestSchema.shape;

export const seedAssetSchema = z.strictObject({
  key: keySchema,
  kind: assetShape.kind,
  name: assetShape.name,
  /** Key of a room in this file. */
  room: keySchema.optional(),
  category: assetShape.category,
  manufacturer: assetShape.manufacturer,
  model: assetShape.model,
  serialNumber: assetShape.serialNumber,
  purchaseDate: assetShape.purchaseDate,
  installedDate: assetShape.installedDate,
  warrantyUntil: assetShape.warrantyUntil,
  warrantyExtendedUntil: assetShape.warrantyExtendedUntil,
  showOnEmergency: assetShape.showOnEmergency,
  notes: assetShape.notes,
  species: assetShape.species,
  light: assetShape.light,
  waterNotes: assetShape.waterNotes,
});

export const seedPreparationSchema = z.strictObject({
  title: createPreparationRequestSchema.shape.title,
  kind: createPreparationRequestSchema.shape.kind,
  leadDays: createPreparationRequestSchema.shape.leadDays,
  leadValue: createPreparationRequestSchema.shape.leadValue,
  qty: createPreparationRequestSchema.shape.qty,
});

/** People are referenced by display name, as the user directory shows them. */
export const seedAssignSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("none") }),
  z.strictObject({ mode: z.literal("fixed"), user: z.string().min(1) }),
  z.strictObject({
    mode: z.literal("rotate"),
    users: z.union([z.literal("all"), z.array(z.string().min(1)).min(1)]),
    strategy: rotationStrategySchema.default("alternate"),
  }),
]);

const taskShape = createTaskRequestSchema.shape;

export const seedTaskSchema = z.strictObject({
  key: keySchema,
  title: taskShape.title,
  descriptionMd: taskShape.descriptionMd,
  category: taskShape.category,
  priority: taskShape.priority,
  effortMinutes: taskShape.effortMinutes,
  /** Key of an asset in this file. */
  asset: keySchema.optional(),
  /** Key of a room in this file. */
  room: keySchema.optional(),
  trigger: triggerSchema,
  assign: seedAssignSchema.default({ mode: "none" }),
  notifyMode: notifyModeSchema.default("assignee"),
  graceDays: taskShape.graceDays,
  dueSoonDays: taskShape.dueSoonDays,
  preparations: z.array(seedPreparationSchema).max(20).default([]),
  /** Documentation for people editing the file; ignored by the importer. */
  comment: z.string().optional(),
});

export const seedSchema = z
  .strictObject({
    version: z.literal(1),
    household: z
      .strictObject({
        name: z.string().trim().min(1).max(100).optional(),
        handoverDate: dateSchema.nullable().optional(),
      })
      .optional(),
    rooms: z.array(seedRoomSchema).max(200).default([]),
    assets: z.array(seedAssetSchema).max(2000).default([]),
    tasks: z.array(seedTaskSchema).max(5000).default([]),
  })
  .superRefine((seed, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    const unique = (section: "rooms" | "assets" | "tasks", keys: string[]) => {
      const seen = new Set<string>();
      keys.forEach((key, index) => {
        if (seen.has(key))
          issue([section, index, "key"], `Duplicate key "${key}"`);
        seen.add(key);
      });
    };
    unique(
      "rooms",
      seed.rooms.map((r) => r.key),
    );
    unique(
      "assets",
      seed.assets.map((a) => a.key),
    );
    unique(
      "tasks",
      seed.tasks.map((t) => t.key),
    );
    const rooms = new Set(seed.rooms.map((r) => r.key));
    const assets = new Set(seed.assets.map((a) => a.key));
    seed.assets.forEach((a, i) => {
      if (a.room && !rooms.has(a.room)) {
        issue(["assets", i, "room"], `Unknown room "${a.room}"`);
      }
    });
    seed.tasks.forEach((t, i) => {
      if (t.room && !rooms.has(t.room)) {
        issue(["tasks", i, "room"], `Unknown room "${t.room}"`);
      }
      if (t.asset && !assets.has(t.asset)) {
        issue(["tasks", i, "asset"], `Unknown asset "${t.asset}"`);
      }
    });
  });
export type Seed = z.output<typeof seedSchema>;
export type SeedInput = z.input<typeof seedSchema>;
export type SeedTask = z.output<typeof seedTaskSchema>;
