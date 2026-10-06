import type { Tool } from "../tool";
import { assetTools } from "./assets";
import { getStats, listNotifications } from "./insights";
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
 * - search           GET /search (documents, attachments, tasks, assets)
 * - pages            get/update documentation pages (scope docs:write for updates)
 * - defects          list/report/update defects
 * - parts and stock  spare parts, stock levels, "order now" list
 * - contacts         tradespeople and service contacts
 * - comments         comments on tasks, assets, defects
 * - hints            hints/tips attached to assets
 * - costs            cost entries and summaries (scope costs:write for writes)
 *
 * The dashboard also reserves openDefects, expiringWarranties and orderNow;
 * `list_upcoming` should include them once the defects, warranty and parts
 * tools exist.
 */
export const tools: readonly Tool[] = [
  whoami,
  listUpcoming,
  ...taskTools,
  ...assetTools,
  getStats,
  listNotifications,
];
