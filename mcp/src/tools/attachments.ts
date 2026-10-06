import { endpoints } from "../../../src/lib/api/registry";
import type { AttachmentOwnerType } from "../../../src/lib/api/enums";
import type { ToolContext } from "../context";

/** Names of the files attached to an entity (photos, manuals); the files themselves are not transferred. */
export async function attachmentRows(
  ctx: ToolContext,
  ownerType: AttachmentOwnerType,
  ownerId: string,
) {
  const page = await ctx.api.call(endpoints.attachmentsList, {
    query: { ownerType, ownerId, limit: 100 },
  });
  return page.items.map((a) => ({
    id: a.id,
    filename: a.filename,
    mime: a.mime,
    caption: a.caption,
    guestVisible: a.guestVisible ? true : null,
  }));
}
