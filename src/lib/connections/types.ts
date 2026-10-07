import type { z } from "zod";
import type {
  externalAreaSchema,
  externalCalendarSchema,
  externalDeviceSchema,
  externalEntitySchema,
} from "$lib/api/schemas/integrations";

export type ExternalEntity = z.infer<typeof externalEntitySchema>;
export type ExternalCalendar = z.infer<typeof externalCalendarSchema>;
export type ExternalDevice = z.infer<typeof externalDeviceSchema>;
export type ExternalArea = z.infer<typeof externalAreaSchema>;
