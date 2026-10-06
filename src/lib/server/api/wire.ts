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
    archivedAt: iso(asset.archivedAt),
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
): z.input<typeof dashboardSchema> {
  return {
    today: d.today,
    generatedAt: toIso(d.generatedAt),
    counts: d.counts,
    upcoming: d.upcoming,
    preparations: d.preparations,
    recentCompletions: d.recentCompletions.map(wireCompletion),
    openDefects: d.openDefects,
    expiringWarranties: d.expiringWarranties,
    orderNow: d.orderNow,
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
