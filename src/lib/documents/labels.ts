import {
  DOCUMENT_LINK_OWNER_TYPES,
  type AttachmentOwnerType,
  type DocumentLinkOwnerType,
  type DocumentLinkRole,
} from "$lib/api/enums";
import { m } from "$lib/paraglide/messages";

export const documentRoleLabels: Record<DocumentLinkRole, () => string> = {
  manual: () => m.document_role_manual(),
  receipt: () => m.document_role_receipt(),
  warranty: () => m.document_role_warranty(),
  datasheet: () => m.document_role_datasheet(),
  correspondence: () => m.document_role_correspondence(),
  invoice: () => m.document_role_invoice(),
  other: () => m.document_role_other(),
};

/** What a document is linked to, in a sentence like "also used for: item «Washer»". */
export const documentOwnerLabels: Record<DocumentLinkOwnerType, () => string> =
  {
    asset: () => m.document_owner_asset(),
    room: () => m.document_owner_room(),
    page: () => m.document_owner_page(),
    task: () => m.document_owner_task(),
    defect: () => m.document_owner_defect(),
    service_log: () => m.document_owner_service_log(),
    part: () => m.document_owner_part(),
    contact: () => m.document_owner_contact(),
    cost: () => m.document_owner_cost(),
  };

const DEFAULT_ROLES: Partial<Record<DocumentLinkOwnerType, DocumentLinkRole>> =
  {
    asset: "manual",
    part: "datasheet",
    defect: "correspondence",
    contact: "correspondence",
    service_log: "invoice",
    cost: "invoice",
  };

/** The role a person most likely wants on this kind of owner; they can change it. */
export function defaultRoleFor(
  ownerType: DocumentLinkOwnerType,
): DocumentLinkRole {
  return DEFAULT_ROLES[ownerType] ?? "other";
}

/** Whether a document can be linked to the owner of an attachment (a care hint cannot). */
export function isLinkableOwner(
  ownerType: AttachmentOwnerType,
): ownerType is DocumentLinkOwnerType {
  return (DOCUMENT_LINK_OWNER_TYPES as readonly string[]).includes(ownerType);
}
