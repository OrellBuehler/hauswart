import { ApiError } from "$lib/api/errors";
import { endpointUrl } from "$lib/api/client";
import { endpoints } from "$lib/api/registry";
import type { AttachmentOwnerType } from "$lib/api/enums";
import {
  attachmentSchema,
  type Attachment,
} from "$lib/api/schemas/attachments";
import { errorEnvelopeSchema } from "$lib/api/schemas/common";

export interface UploadInput {
  file: File;
  ownerType: AttachmentOwnerType;
  ownerId: string;
  caption?: string | undefined;
  guestVisible?: boolean | undefined;
}

function parse(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch (err) {
    if (err instanceof SyntaxError) return undefined;
    throw err;
  }
}

/**
 * Uploads one file as multipart. `api.call` would do, but `fetch` cannot report upload progress, which
 * matters for a 25 MiB photo on a mobile connection.
 */
export function uploadAttachment(
  input: UploadInput,
  onProgress: (fraction: number) => void,
): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", input.file, input.file.name);
    form.append("ownerType", input.ownerType);
    form.append("ownerId", input.ownerId);
    if (input.caption) form.append("caption", input.caption);
    if (input.guestVisible !== undefined) {
      form.append("guestVisible", String(input.guestVisible));
    }

    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpointUrl(endpoints.attachmentsUpload));
    xhr.setRequestHeader("accept", "application/json");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(event.loaded / event.total);
      }
    };
    xhr.onerror = () =>
      reject(new ApiError("internal", "The upload failed", { status: 0 }));
    xhr.ontimeout = xhr.onerror;
    xhr.onload = () => {
      const json = parse(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        const parsed = attachmentSchema.safeParse(json);
        if (parsed.success) resolve(parsed.data);
        else {
          reject(
            new ApiError(
              "internal",
              "The server response did not match the API contract",
              { status: xhr.status },
            ),
          );
        }
        return;
      }
      const envelope = errorEnvelopeSchema.safeParse(json);
      if (envelope.success) {
        const { code, message, details } = envelope.data.error;
        reject(new ApiError(code, message, { status: xhr.status, details }));
      } else {
        reject(
          new ApiError("internal", `Upload failed with status ${xhr.status}`, {
            status: xhr.status,
          }),
        );
      }
    };
    xhr.send(form);
  });
}
