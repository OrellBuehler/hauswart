import { z } from "zod";
import {
  atLeastOne,
  isoTimestampSchema,
  nullableText,
  paginated,
  paginationQuerySchema,
  slugSchema,
} from "./common";

export const ROOM_NAME_MAX = 100;

export const roomSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    haAreaId: z.string().nullable(),
    icon: z.string().nullable(),
    sortOrder: z.number().int(),
    notes: z.string().nullable(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .meta({ id: "Room" });
export type Room = z.infer<typeof roomSchema>;

export const listRoomsQuerySchema = paginationQuerySchema;
export const listRoomsResponseSchema = paginated(roomSchema);

const roomFields = {
  name: z.string().trim().min(1).max(ROOM_NAME_MAX),
  slug: slugSchema,
  haAreaId: nullableText(200),
  icon: nullableText(64),
  sortOrder: z.number().int().min(0).max(100_000),
  notes: nullableText(10_000),
};

/** `slug` is derived from the name when omitted. */
export const createRoomRequestSchema = z.strictObject({
  name: roomFields.name,
  slug: roomFields.slug.optional(),
  haAreaId: roomFields.haAreaId.optional(),
  icon: roomFields.icon.optional(),
  sortOrder: roomFields.sortOrder.optional(),
  notes: roomFields.notes.optional(),
});
export type CreateRoomRequest = z.output<typeof createRoomRequestSchema>;

export const updateRoomRequestSchema = atLeastOne(
  z.strictObject({
    name: roomFields.name.optional(),
    slug: roomFields.slug.optional(),
    haAreaId: roomFields.haAreaId.optional(),
    icon: roomFields.icon.optional(),
    sortOrder: roomFields.sortOrder.optional(),
    notes: roomFields.notes.optional(),
  }),
);
export type UpdateRoomRequest = z.output<typeof updateRoomRequestSchema>;
