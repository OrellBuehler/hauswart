import type { AttachmentOwnerType } from "$lib/api/enums";
import { DEFAULT_MAX_BYTES } from "$lib/server/files/store";
import {
  fetchPublicFile,
  PublicFetchError,
  type PublicFetchOptions,
} from "$lib/server/net/public-fetch";
import {
  invalidField,
  invalidFieldWith,
  type ServiceContext,
} from "$lib/server/service";
import { APP_VERSION } from "$lib/server/version";
import { createAttachment, type AttachmentRecord } from "./attachments";
import { isOwnerTypeSupported, ownerExists } from "./owners";

type Now = Pick<ServiceContext, "db" | "now">;

export interface AttachFromUrl {
  ownerType: AttachmentOwnerType;
  ownerId: string;
  url: string;
  caption?: string;
  guestVisible?: boolean;
  uploadedBy: string | null;
}

/** What the request says about itself: a plain program name and version and the types an attachment can be. */
const REQUEST: Pick<PublicFetchOptions, "accept" | "userAgent"> = {
  accept: "image/jpeg, image/png, image/webp, application/pdf, */*;q=0.1",
  get userAgent() {
    return `hauswart/${APP_VERSION}`;
  },
};

/** The last part of the path, decoded, as the name of the file; the store makes it safe and gives it the right extension. */
function filenameOf(url: URL): string {
  const segment = url.pathname.split("/").filter(Boolean).pop() ?? "";
  try {
    return decodeURIComponent(segment) || "download";
  } catch {
    // A malformed percent sequence: the raw segment is still a usable name.
    return segment || "download";
  }
}

/**
 * Downloads the file at `input.url` and attaches it to the owner as an upload would be: the owner is checked first (a
 * missing one costs no request), then the file is fetched under the strict address policy of `fetchPublicFile` and handed
 * to the same pipeline as an upload (`createAttachment`: type sniffing, images re-encoded and stripped, PDFs as they are,
 * 25 MiB). A download that fails is a 400 on `url` whose `details.code` says why (`FROM_URL_ERROR_CODES`, `details.status`
 * for `upstream_status`); what the store refuses keeps its own codes. Only the code is logged, never the address.
 */
export async function attachFromUrl(
  ctx: Now,
  input: AttachFromUrl,
  options: Partial<PublicFetchOptions> = {},
): Promise<AttachmentRecord> {
  if (!isOwnerTypeSupported(input.ownerType)) {
    throw invalidField("ownerType", "Attachments are not available for this");
  }
  if (!ownerExists(ctx, input.ownerType, input.ownerId)) {
    throw invalidField("ownerId", "Owner does not exist");
  }
  let file;
  try {
    file = await fetchPublicFile(input.url, {
      maxBytes: DEFAULT_MAX_BYTES,
      ...REQUEST,
      ...options,
    });
  } catch (err) {
    if (!(err instanceof PublicFetchError)) throw err;
    console.warn(
      JSON.stringify({
        event: "attachments.from_url_failed",
        code: err.code,
        status: err.status,
      }),
    );
    throw invalidFieldWith("url", err.message, {
      code: err.code,
      ...(err.status === undefined ? {} : { status: err.status }),
    });
  }
  return createAttachment(ctx, {
    bytes: file.bytes,
    filename: filenameOf(file.url),
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    caption: input.caption,
    guestVisible: input.guestVisible,
    uploadedBy: input.uploadedBy,
  });
}
