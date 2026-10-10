import type { Tool } from "../tool";
import { assetTools } from "./assets";
import { assetCareTools } from "./asset-care";
import { commentTools } from "./comments";
import { contactTools } from "./contacts";
import { costTools } from "./costs";
import { defectTools } from "./defects";
import { docTools } from "./docs";
import { documentTools } from "./documents";
import { financeTools } from "./finance";
import { getStats, listNotifications } from "./insights";
import { insuranceTools } from "./insurance";
import { partTools } from "./parts";
import { taskTools } from "./tasks";
import { listUpcoming } from "./upcoming";
import { vehicleTools } from "./vehicles";
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
 * - guest link       the guest link and what it shows
 * - iCal feed        subscribing to due dates
 *
 * Not offered on purpose: deleting anything (the one exception is unlinking a
 * document, which only removes the link), uploading files (attachments are listed
 * by name only), sending files to the document system and changing contacts or
 * parts beyond stock bookings.
 */
export const tools: readonly Tool[] = [
  whoami,
  listUpcoming,
  ...taskTools,
  ...assetTools,
  getStats,
  listNotifications,
  ...docTools,
  ...documentTools,
  ...defectTools,
  ...partTools,
  ...contactTools,
  ...commentTools,
  ...costTools,
  ...assetCareTools,
  ...insuranceTools,
  ...financeTools,
  ...vehicleTools,
];
