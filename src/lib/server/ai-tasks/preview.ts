import {
  AI_TASK_PREVIEW_MAX_BYTES,
  AI_TASK_PREVIEW_MAX_SIDE,
} from "$lib/api/schemas/ai-tasks";
import { openAttachmentFile } from "$lib/server/attachments/attachments";
import { defaultFilesRoot } from "$lib/server/files/store";
import { withExtension } from "$lib/server/files/filename";
import { previewImage } from "$lib/server/files/preview";
import { notFound, type ServiceContext } from "$lib/server/service";
import { getAiTask } from "./ai-tasks";

export interface TaskPreview {
  bytes: Uint8Array;
  mime: string;
  filename: string;
  etag: string;
  scaled: boolean;
}

/**
 * The task's file as an assistant reads it: an image of at most `AI_TASK_PREVIEW_MAX_SIDE` px and
 * `AI_TASK_PREVIEW_MAX_BYTES` (as stored when it fits already, else scaled down to JPEG), a PDF as stored. 404 when the
 * task has no file (any more).
 */
export async function taskPreview(
  ctx: Pick<ServiceContext, "db">,
  id: string,
  root: string = defaultFilesRoot(),
): Promise<TaskPreview> {
  const file = getAiTask(ctx, id).attachment;
  if (!file) throw notFound("File");
  const stored = await openAttachmentFile(file, "content", root);
  if (!stored) {
    console.error(
      JSON.stringify({ event: "ai_tasks.file_missing", id: file.id }),
    );
    throw notFound("File");
  }
  const bytes = new Uint8Array(await stored.arrayBuffer());
  if (
    file.mime === "application/pdf" ||
    file.width === null ||
    file.height === null
  ) {
    return {
      bytes,
      mime: file.mime,
      filename: file.filename,
      etag: `"${file.sha256}"`,
      scaled: false,
    };
  }
  const image = await previewImage(
    { bytes, mime: file.mime, width: file.width, height: file.height },
    { maxSide: AI_TASK_PREVIEW_MAX_SIDE, maxBytes: AI_TASK_PREVIEW_MAX_BYTES },
  );
  return {
    bytes: image.bytes,
    mime: image.mime,
    filename: image.scaled
      ? withExtension(file.filename, "jpg", ["jpeg"])
      : file.filename,
    etag: `"${file.sha256}${image.scaled ? "-preview" : ""}"`,
    scaled: image.scaled,
  };
}
