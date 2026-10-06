import type { CommentEntityType, DocumentLinkOwnerType } from "$lib/api/enums";
import { commentableOf } from "$lib/server/comments/registry";
import type { DB } from "$lib/server/db";

const COMMENT_TYPE: Record<DocumentLinkOwnerType, CommentEntityType> = {
  asset: "asset",
  room: "room",
  page: "doc_page",
  task: "task",
  defect: "defect",
  service_log: "service_log",
  part: "part",
  contact: "contact",
};

export interface OwnerInfo {
  title: string;
  /** App path of the owner (its page in the UI). */
  url: string;
}

/** What a document link's owner is called and where it lives; null when it does not exist. */
export function ownerInfo(
  db: DB,
  type: DocumentLinkOwnerType,
  id: string,
): OwnerInfo | null {
  const entity = commentableOf(COMMENT_TYPE[type]);
  if (!entity || !entity.exists(db, id)) return null;
  return { title: entity.title(db, id) ?? "", url: entity.url(db, id) };
}
