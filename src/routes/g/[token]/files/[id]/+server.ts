import { error } from "@sveltejs/kit";
import { openAttachmentFile } from "$lib/server/attachments/attachments";
import { getDB } from "$lib/server/db";
import { defaultDisposition, fileResponse } from "$lib/server/files/serve";
import { GUEST_ERRORS, guestGate } from "$lib/server/share/guest-http";
import { getGuestFile } from "$lib/server/share/guest-view";
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
