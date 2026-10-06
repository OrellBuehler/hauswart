import { z } from "zod";
import { WARRANTY_STATUSES } from "../enums";
import { dateSchema, paginated, paginationQuerySchema } from "./common";

export const WARRANTY_EXPIRING_DAYS = 90;
/** The dashboard keeps showing a warranty for this long after it ran out. */
export const WARRANTY_EXPIRED_GRACE_DAYS = 30;

export const warrantyStatusSchema = z.enum(WARRANTY_STATUSES);

export const warrantySchema = z
  .object({
    assetId: z.string(),
    assetName: z.string(),
    roomName: z.string().nullable(),
    manufacturer: z.string().nullable(),
    model: z.string().nullable(),
    purchaseDate: dateSchema.nullable(),
    warrantyUntil: dateSchema.nullable(),
    warrantyExtendedUntil: dateSchema.nullable(),
    /** The later of the two dates: the warranty holds through this day. */
    effectiveUntil: dateSchema,
    /** `expired` once the day has passed, `expiring` within 90 days, else `valid`. */
    status: warrantyStatusSchema,
    /** Days from today to `effectiveUntil`; negative once expired. */
    daysLeft: z.number().int(),
  })
  .meta({ id: "Warranty" });
export type Warranty = z.infer<typeof warrantySchema>;

export const listWarrantiesQuerySchema = paginationQuerySchema.extend({
  status: warrantyStatusSchema.optional(),
});
export const listWarrantiesResponseSchema = paginated(warrantySchema);
