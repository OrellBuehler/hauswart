import { error } from "@sveltejs/kit";
import { openAttachmentFile } from "#lib/server/attachments/attachments.ts";
import { getDB } from "#lib/server/db.ts";
import { defaultDisposition, fileResponse } from "#lib/server/files/serve.ts";
import { GUEST_ERRORS, guestGate } from "#lib/server/share/guest-http.ts";
import { getGuestFile } from "#lib/server/share/guest-view.ts";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async (event) => {
  const access = guestGate(event, event.params.token);
  if (access.state !== "ok") error(404, GUEST_ERRORS.gone);
  const attachment = getGuestFile(
    { db: getDB() },
    access.link,
    event.params.id,
  );
  if (!attachment) error(404, GUEST_ERRORS.page);
  const file = await openAttachmentFile(attachment, "content");
  if (!file) {
    console.error(
      JSON.stringify({
        event: "guest.file_missing",
        id: attachment.id,
      }),
    );
    error(404, GUEST_ERRORS.page);
  }
  return fileResponse(file, {
    mime: attachment.mime,
    filename: attachment.filename,
    disposition: defaultDisposition(attachment.mime),
    cache: "no-store",
  });
};
