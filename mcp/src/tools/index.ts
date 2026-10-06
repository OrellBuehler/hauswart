import type { Tool } from "../tool";
import { assetTools } from "./assets";
import { assetCareTools } from "./asset-care";
import { commentTools } from "./comments";
import { contactTools } from "./contacts";
import { defectTools } from "./defects";
import { docTools } from "./docs";
import { getStats, listNotifications } from "./insights";
import { partTools } from "./parts";
import { taskTools } from "./tasks";
import { listUpcoming } from "./upcoming";
import { whoami } from "./whoami";

/**
 * Every tool the server can offer. The server registers those whose scopes the
 * token holds, so a read-only token never sees the write tools.
 *
 * Adding a tool: write `defineTool({ name, title, description, mode, input,
 * handler })` in a file under `tools/` (see `insights.ts` for a small one), call
 * the typed client with an endpoint from `endpoints`, and add it below. Tools for
 * endpoints that do not exist yet go here once the endpoint is in the registry:
 *
 * - costs            cost entries and summaries (scope costs:write for writes)
 * - guest link       the guest link and what it shows
 * - iCal feed        subscribing to due dates
 *
 * Not offered on purpose: deleting anything, uploading files (attachments are
 * listed by name only) and changing contacts or parts beyond stock bookings.
 */
export const tools: readonly Tool[] = [
  whoami,
  listUpcoming,
  ...taskTools,
  ...assetTools,
  getStats,
  listNotifications,
  ...docTools,
  ...defectTools,
  ...partTools,
  ...contactTools,
  ...commentTools,
  ...assetCareTools,
];
