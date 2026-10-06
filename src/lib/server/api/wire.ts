import type { z } from "zod";
import { toIso } from "$lib/api/schemas/common";
import type { userSchema } from "$lib/api/schemas/auth";
import type { adminUserSchema } from "$lib/api/schemas/users";
import type { apiTokenSchema } from "$lib/api/schemas/tokens";
import type { SessionUser } from "$lib/server/auth/types";
import type { TokenRecord } from "$lib/server/auth/tokens";
import type { UserRecord } from "$lib/server/users/users";
import type { roomSchema } from "$lib/api/schemas/rooms";
import type { assetSchema } from "$lib/api/schemas/assets";
import type {
  completionSchema,
  preparationSchema,
  taskSchema,
  taskStateSchema,
} from "$lib/api/schemas/tasks";
import type { dashboardSchema } from "$lib/api/schemas/dashboard";
import type { notificationSchema } from "$lib/api/schemas/notifications";
import type { householdSchema } from "$lib/api/schemas/household";
import type {
  docPageSchema,
  docPageSummarySchema,
  pageRevisionSchema,
  pageRevisionSummarySchema,
} from "$lib/api/schemas/docs";
import type { attachmentSchema } from "$lib/api/schemas/attachments";
import type { AttachmentRecord } from "$lib/server/attachments/attachments";
import {
  excerptOf,
  type PageDetail,
  type PageRecord,
  type RevisionRecord,
  type RevisionSummary,
} from "$lib/server/docs/pages";
import type { RoomRecord } from "$lib/server/rooms/rooms";
import type { AssetRecord } from "$lib/server/assets/assets";
import type { TaskRecord } from "$lib/server/tasks/tasks";
import type { TaskStateRecord } from "$lib/server/tasks/state";
import type { CompletionRecord } from "$lib/server/tasks/completions";
import type { PreparationRecord } from "$lib/server/tasks/preparations";
import type { DashboardRecord } from "$lib/server/tasks/dashboard";
import type { NotificationRow } from "$lib/server/notifications/notifications";
import type { HouseholdRecord } from "$lib/server/household/household";
import type {
  contactSchema,
  assetContactSchema,
} from "$lib/api/schemas/contacts";
import type {
  assetPartSchema,
  orderNowItemSchema,
  partDetailSchema,
  partMovementSchema,
  partSchema,
  taskPartSchema,
} from "$lib/api/schemas/parts";
import type { serviceLogEntrySchema } from "$lib/api/schemas/service-log";
import type {
  defectDetailSchema,
  defectEventSchema,
  defectSchema,
  defectTimelineItemSchema,
} from "$lib/api/schemas/defects";
import type { warrantySchema } from "$lib/api/schemas/warranties";
import type { commentSchema } from "$lib/api/schemas/comments";
import type { hintSchema } from "$lib/api/schemas/hints";
import type {
  AssetContactRecord,
  ContactRow,
} from "$lib/server/contacts/contacts";
import type { AssetPartRecord, TaskPartRecord } from "$lib/server/parts/links";
import type { OrderNowRecord } from "$lib/server/parts/order-now";
import type {
  MovementRecord,
  PartDetailRecord,
  PartRecord,
} from "$lib/server/parts/parts";
import type { ServiceLogRecord } from "$lib/server/service-log/service-log";
import type {
  DefectDetailRecord,
  DefectEventRecord,
  DefectRecord,
  TimelineItem,
} from "$lib/server/defects/defects";
import type { WarrantyRecord } from "$lib/server/warranties/warranties";
import type { CommentRecord } from "$lib/server/comments/comments";
import type { HintRecord } from "$lib/server/hints/hints";

/** Explicit field lists: a row never reaches the wire by accident (password hashes, token hashes). */
export function wireUser(user: SessionUser): z.input<typeof userSchema> {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    locale: user.locale,
  };
}

export function wireAdminUser(
  user: UserRecord,
): z.input<typeof adminUserSchema> {
  return {
    ...wireUser(user),
    ownershipBps: user.ownershipBps,
    createdAt: toIso(user.createdAt),
  };
}

export function wireToken(token: TokenRecord): z.input<typeof apiTokenSchema> {
  return {
    id: token.id,
    kind: token.kind,
    name: token.name,
    prefix: token.prefix,
    scopes: token.scopes,
    lastUsedAt: token.lastUsedAt ? toIso(token.lastUsedAt) : null,
    expiresAt: token.expiresAt ? toIso(token.expiresAt) : null,
    createdAt: toIso(token.createdAt),
  };
}

const iso = (value: Date | null): string | null =>
  value ? toIso(value) : null;

export function wireRoom(room: RoomRecord): z.input<typeof roomSchema> {
  return {
    id: room.id,
    name: room.name,
    slug: room.slug,
    haAreaId: room.haAreaId,
    icon: room.icon,
    sortOrder: room.sortOrder,
    notes: room.notes,
    createdAt: toIso(room.createdAt),
    updatedAt: toIso(room.updatedAt),
  };
}

export function wireAsset(asset: AssetRecord): z.input<typeof assetSchema> {
  return {
    id: asset.id,
    kind: asset.kind,
    name: asset.name,
    slug: asset.slug,
    qrSlug: asset.qrSlug,
    roomId: asset.roomId,
    roomName: asset.roomName,
    category: asset.category,
    manufacturer: asset.manufacturer,
    model: asset.model,
    serialNumber: asset.serialNumber,
    purchaseDate: asset.purchaseDate,
    installedDate: asset.installedDate,
    warrantyUntil: asset.warrantyUntil,
    warrantyExtendedUntil: asset.warrantyExtendedUntil,
    showOnEmergency: asset.showOnEmergency,
    notes: asset.notes,
    species: asset.species,
    light: asset.light,
    waterNotes: asset.waterNotes,
    photoAttachmentId: asset.photoAttachmentId,
    photoUrl: asset.photoAttachmentId
      ? `/api/v1/attachments/${asset.photoAttachmentId}/thumb`
      : null,
    archivedAt: iso(asset.archivedAt),
    commentCount: asset.commentCount,
    createdAt: toIso(asset.createdAt),
    updatedAt: toIso(asset.updatedAt),
  };
}

export function wireTaskState(
  state: TaskStateRecord,
): z.input<typeof taskStateSchema> {
  return {
    status: state.status,
    dueDate: state.dueDate,
    dueKind: state.dueKind,
    occurrenceKey: state.occurrenceKey,
    windowStart: state.windowStart,
    progress: state.progress,
    estimate: state.estimate,
    missedCount: state.missedCount,
    reasons: state.reasons,
    currentAssigneeUserId: state.currentAssigneeUserId,
    evaluatedAt: toIso(state.evaluatedAt),
  };
}

export function wireTask(task: TaskRecord): z.input<typeof taskSchema> {
  return {
    id: task.id,
    title: task.title,
    descriptionMd: task.descriptionMd,
    category: task.category,
    priority: task.priority,
    effortMinutes: task.effortMinutes,
    assetId: task.assetId,
    assetName: task.assetName,
    roomId: task.roomId,
    roomName: task.roomName,
    trigger: task.trigger,
    assignMode: task.assignMode,
    assigneeUserId: task.assigneeUserId,
    rotationOrder: task.rotationOrder,
    rotationStrategy: task.rotationStrategy,
    notifyMode: task.notifyMode,
    graceDays: task.graceDays,
    dueSoonDays: task.dueSoonDays,
    snoozedUntil: task.snoozedUntil,
    archivedAt: iso(task.archivedAt),
    source: task.source,
    externalSource: task.externalSource,
    externalRef: task.externalRef,
    externalUrl: task.externalUrl,
    createdBy: task.createdBy,
    commentCount: task.commentCount,
    createdAt: toIso(task.createdAt),
    updatedAt: toIso(task.updatedAt),
    state: task.state ? wireTaskState(task.state) : null,
  };
}

export function wireCompletion(
  completion: CompletionRecord,
): z.input<typeof completionSchema> {
  return {
    id: completion.id,
    taskId: completion.taskId,
    taskTitle: completion.taskTitle,
    kind: completion.kind,
    source: completion.source,
    completedAt: toIso(completion.completedAt),
    completedDate: completion.completedDate,
    userId: completion.userId,
    userName: completion.userName,
    counterValue: completion.counterValue,
    occurrenceKey: completion.occurrenceKey,
    dueDateAtCompletion: completion.dueDateAtCompletion,
    note: completion.note,
    revokedAt: iso(completion.revokedAt),
    createdAt: toIso(completion.createdAt),
  };
}

export function wirePreparation(
  prep: PreparationRecord,
): z.input<typeof preparationSchema> {
  return {
    id: prep.id,
    taskId: prep.taskId,
    title: prep.title,
    kind: prep.kind,
    leadDays: prep.leadDays,
    leadValue: prep.leadValue,
    partId: prep.partId,
    qty: prep.qty,
    sortOrder: prep.sortOrder,
    state: prep.state,
  };
}

export function wireNotification(
  row: NotificationRow,
): z.input<typeof notificationSchema> {
  return {
    id: row.id,
    kind: row.kind,
    taskId: row.taskId,
    titleKey: row.titleKey,
    params: row.paramsJson,
    url: row.url,
    createdAt: toIso(row.createdAt),
    readAt: iso(row.readAt),
  };
}

export function wireHousehold(
  household: HouseholdRecord,
): z.input<typeof householdSchema> {
  return {
    name: household.name,
    timezone: household.timezone,
    currency: household.currency,
    handoverDate: household.handoverDate,
    settings: household.settings,
    updatedAt: toIso(household.updatedAt),
  };
}

export function wireDashboard(
  d: DashboardRecord,
  extras: {
    openDefects: DefectRecord[];
    expiringWarranties: WarrantyRecord[];
    orderNow: OrderNowRecord[];
  },
): z.input<typeof dashboardSchema> {
  return {
    today: d.today,
    generatedAt: toIso(d.generatedAt),
    counts: d.counts,
    upcoming: d.upcoming,
    preparations: d.preparations,
    recentCompletions: d.recentCompletions.map(wireCompletion),
    openDefects: extras.openDefects.map((x) => ({
      id: x.id,
      title: x.title,
      date: x.deadlineDate,
      number: x.number,
      status: x.status,
      severity: x.severity,
      roomName: x.roomName,
      assetName: x.assetName,
    })),
    expiringWarranties: extras.expiringWarranties.map((w) => ({
      id: w.assetId,
      title: w.assetName,
      date: w.effectiveUntil,
      assetId: w.assetId,
      status: w.status,
      daysLeft: w.daysLeft,
    })),
    orderNow: extras.orderNow.map(wireOrderNow),
  };
}

export function wireContact(c: ContactRow): z.input<typeof contactSchema> {
  return {
    id: c.id,
    kind: c.kind,
    name: c.name,
    company: c.company,
    phone: c.phone,
    email: c.email,
    url: c.url,
    address: c.address,
    notes: c.notes,
    emergency: c.emergency,
    guestVisible: c.guestVisible,
    sortOrder: c.sortOrder,
    externalSource: c.externalSource,
    externalRef: c.externalRef,
    createdAt: toIso(c.createdAt),
    updatedAt: toIso(c.updatedAt),
  };
}

export function wireAssetContact(
  link: AssetContactRecord,
): z.input<typeof assetContactSchema> {
  return {
    id: link.id,
    assetId: link.assetId,
    contactId: link.contactId,
    role: link.role,
    contact: wireContact(link.contact),
  };
}

export function wirePart(part: PartRecord): z.input<typeof partSchema> {
  return {
    id: part.id,
    name: part.name,
    partNumber: part.partNumber,
    supplier: part.supplier,
    shopUrl: part.shopUrl,
    unitPriceMinor: part.unitPriceMinor,
    currency: part.currency,
    stockCount: part.stockCount,
    minStock: part.minStock,
    reorderQty: part.reorderQty,
    leadTimeDays: part.leadTimeDays,
    orderedAt: iso(part.orderedAt),
    orderedQty: part.orderedQty,
    lowStock: part.lowStock,
    notes: part.notes,
    archivedAt: iso(part.archivedAt),
    createdAt: toIso(part.createdAt),
    updatedAt: toIso(part.updatedAt),
  };
}

export function wireMovement(
  m: MovementRecord,
): z.input<typeof partMovementSchema> {
  return {
    id: m.id,
    partId: m.partId,
    delta: m.delta,
    reason: m.reason,
    userId: m.userId,
    userName: m.userName,
    completionId: m.completionId,
    note: m.note,
    at: toIso(m.at),
  };
}

export function wirePartDetail(
  part: PartDetailRecord,
): z.input<typeof partDetailSchema> {
  return {
    ...wirePart(part),
    assets: part.assets,
    tasks: part.tasks,
    recentMovements: part.recentMovements.map(wireMovement),
  };
}

export function wireAssetPart(
  link: AssetPartRecord,
): z.input<typeof assetPartSchema> {
  return {
    assetId: link.assetId,
    partId: link.partId,
    part: wirePart(link.part),
  };
}

export function wireTaskPart(
  link: TaskPartRecord,
): z.input<typeof taskPartSchema> {
  return {
    taskId: link.taskId,
    partId: link.partId,
    qty: link.qty,
    part: wirePart(link.part),
  };
}

export function wireOrderNow(
  item: OrderNowRecord,
): z.input<typeof orderNowItemSchema> {
  return {
    id: `${item.taskId}:${item.partId}`,
    title: item.partName,
    date: item.orderBy,
    taskId: item.taskId,
    taskTitle: item.taskTitle,
    partId: item.partId,
    partName: item.partName,
    quantity: item.quantity,
    neededBy: item.neededBy,
    orderBy: item.orderBy,
    late: item.late,
    stockCount: item.stockCount,
    supplier: item.supplier,
    shopUrl: item.shopUrl,
    unitPriceMinor: item.unitPriceMinor,
    currency: item.currency,
  };
}

export function wireServiceLogEntry(
  e: ServiceLogRecord,
): z.input<typeof serviceLogEntrySchema> {
  return {
    id: e.id,
    assetId: e.assetId,
    assetName: e.assetName,
    date: e.date,
    kind: e.kind,
    title: e.title,
    descriptionMd: e.descriptionMd,
    contactId: e.contactId,
    contactName: e.contactName,
    completionId: e.completionId,
    costMinor: e.costMinor,
    currency: e.currency,
    costEntryId: e.costEntryId,
    performedBy: e.performedBy,
    createdBy: e.createdBy,
    commentCount: e.commentCount,
    createdAt: toIso(e.createdAt),
    updatedAt: toIso(e.updatedAt),
  };
}

export function wireDefect(d: DefectRecord): z.input<typeof defectSchema> {
  return {
    id: d.id,
    number: d.number,
    title: d.title,
    descriptionMd: d.descriptionMd,
    status: d.status,
    severity: d.severity,
    roomId: d.roomId,
    roomName: d.roomName,
    assetId: d.assetId,
    assetName: d.assetName,
    locationDetail: d.locationDetail,
    discoveredOn: d.discoveredOn,
    reportedOn: d.reportedOn,
    responsibleContactId: d.responsibleContactId,
    responsibleContactName: d.responsibleContactName,
    deadlineDate: d.deadlineDate,
    deadlineSource: d.deadlineSource,
    fixedOn: d.fixedOn,
    resolutionMd: d.resolutionMd,
    costEntryId: d.costEntryId,
    reminderTaskId: d.reminderTaskId,
    commentCount: d.commentCount,
    createdBy: d.createdBy,
    createdAt: toIso(d.createdAt),
    updatedAt: toIso(d.updatedAt),
  };
}

export function wireDefectEvent(
  e: DefectEventRecord,
): z.input<typeof defectEventSchema> {
  return {
    id: e.id,
    defectId: e.defectId,
    at: toIso(e.at),
    userId: e.userId,
    userName: e.userName,
    type: e.type,
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
    bodyMd: e.bodyMd,
    externalRef: e.externalRef,
  };
}

export function wireDefectDetail(
  d: DefectDetailRecord,
): z.input<typeof defectDetailSchema> {
  return { ...wireDefect(d), events: d.events.map(wireDefectEvent) };
}

export function wireTimelineItem(
  item: TimelineItem,
): z.input<typeof defectTimelineItemSchema> {
  if (item.kind === "event") {
    return {
      kind: "event",
      id: item.id,
      at: toIso(item.at),
      userId: item.userId,
      userName: item.userName,
      type: item.type,
      fromStatus: item.fromStatus,
      toStatus: item.toStatus,
      bodyMd: item.bodyMd,
      externalRef: item.externalRef,
    };
  }
  return {
    kind: "comment",
    id: item.id,
    at: toIso(item.at),
    userId: item.userId,
    userName: item.userName,
    bodyMd: item.bodyMd,
    editedAt: iso(item.editedAt),
    deleted: item.deleted,
  };
}

export function wireWarranty(
  w: WarrantyRecord,
): z.input<typeof warrantySchema> {
  return {
    assetId: w.assetId,
    assetName: w.assetName,
    roomName: w.roomName,
    manufacturer: w.manufacturer,
    model: w.model,
    purchaseDate: w.purchaseDate,
    warrantyUntil: w.warrantyUntil,
    warrantyExtendedUntil: w.warrantyExtendedUntil,
    effectiveUntil: w.effectiveUntil,
    status: w.status,
    daysLeft: w.daysLeft,
  };
}

export function wireComment(c: CommentRecord): z.input<typeof commentSchema> {
  return {
    id: c.id,
    entityType: c.entityType,
    entityId: c.entityId,
    author: c.author,
    bodyMd: c.bodyMd,
    createdAt: toIso(c.createdAt),
    editedAt: iso(c.editedAt),
    deleted: c.deleted,
    canEdit: c.canEdit,
    canDelete: c.canDelete,
  };
}

export function wireHint(h: HintRecord): z.input<typeof hintSchema> {
  return {
    id: h.id,
    assetId: h.assetId,
    assetName: h.assetName,
    title: h.title,
    bodyMd: h.bodyMd,
    kind: h.kind,
    pinned: h.pinned,
    sortOrder: h.sortOrder,
    guestVisible: h.guestVisible,
    taskId: h.taskId,
    taskTitle: h.taskTitle,
    reaction: h.reaction,
    commentCount: h.commentCount,
    createdAt: toIso(h.createdAt),
    updatedAt: toIso(h.updatedAt),
  };
}

export function wirePageSummary(
  page: PageRecord,
): z.input<typeof docPageSummarySchema> {
  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    section: page.section,
    assetId: page.assetId,
    roomId: page.roomId,
    sortOrder: page.sortOrder,
    guestVisible: page.guestVisible,
    pinned: page.pinned,
    rev: page.rev,
    excerpt: excerptOf(page),
    commentCount: page.commentCount,
    updatedBy: page.updatedBy,
    updatedByName: page.updatedByName,
    archivedAt: iso(page.archivedAt),
    createdAt: toIso(page.createdAt),
    updatedAt: toIso(page.updatedAt),
  };
}

/** The member view: markdown source and the HTML that includes secret blocks. */
export function wirePage(page: PageDetail): z.input<typeof docPageSchema> {
  return {
    ...wirePageSummary(page),
    bodyMd: page.bodyMd,
    renderedHtml: page.renderedHtmlMember,
    headings: page.headingsJson.member,
    backlinks: page.backlinks,
  };
}

export function wireRevisionSummary(
  revision: RevisionSummary,
): z.input<typeof pageRevisionSummarySchema> {
  return {
    rev: revision.rev,
    title: revision.title,
    size: revision.size,
    userId: revision.userId,
    userName: revision.userName,
    createdAt: toIso(revision.createdAt),
  };
}

export function wireRevision(
  revision: RevisionRecord,
): z.input<typeof pageRevisionSchema> {
  return { ...wireRevisionSummary(revision), bodyMd: revision.bodyMd };
}

export function wireAttachment(
  row: AttachmentRecord,
): z.input<typeof attachmentSchema> {
  return {
    id: row.id,
    ownerType: row.ownerType,
    ownerId: row.ownerId,
    filename: row.filename,
    mime: row.mime,
    size: row.size,
    width: row.width,
    height: row.height,
    caption: row.caption,
    guestVisible: row.guestVisible,
    url: `/api/v1/attachments/${row.id}/content`,
    thumbUrl: row.thumbPath ? `/api/v1/attachments/${row.id}/thumb` : null,
    uploadedBy: row.uploadedBy,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}
