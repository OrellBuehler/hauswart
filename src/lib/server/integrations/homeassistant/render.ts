import type { UserLocale } from "$lib/api/enums";
import { m } from "$lib/paraglide/messages";
import type {
  ChannelAction,
  DeliverableNotification,
} from "$lib/server/notifications/channels";
import { ACTION_DONE_PREFIX } from "$lib/server/notifications/actions";
import {
  buildActionableNotification,
  notificationActionToken,
  type InterruptionLevel,
  type NotificationPayload,
} from "./helpers";

type Render = (
  params: Record<string, string | number>,
  options: { locale: UserLocale },
) => string;

const INTL_LOCALE: Record<UserLocale, string> = { de: "de-CH", en: "en-GB" };
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

function localizedParams(
  params: Record<string, string | number>,
  locale: UserLocale,
): Record<string, string | number> {
  const out = { ...params };
  if (typeof out.date === "string") {
    out.date = CALENDAR_DATE.test(out.date)
      ? new Intl.DateTimeFormat(INTL_LOCALE[locale], {
          dateStyle: "medium",
          timeZone: "UTC",
        }).format(new Date(`${out.date}T00:00:00Z`))
      : "–";
  }
  return out;
}

const TITLES: Record<string, Render> = {
  prep: (p, o) => m.push_title_prep(p, o),
  due_soon: (p, o) => m.push_title_due_soon(p, o),
  due: (p, o) => m.push_title_due(p, o),
  overdue: (p, o) => m.push_title_overdue(p, o),
  digest: (p, o) => m.push_title_digest(p, o),
  hint: (p, o) => m.push_title_hint(p, o),
  comment: (p, o) => m.push_title_comment(p, o),
  info: (p, o) => m.push_title_info(p, o),
};

const LEVELS: Record<string, InterruptionLevel> = {
  overdue: "time-sensitive",
  due: "active",
  due_soon: "active",
  prep: "active",
  hint: "active",
  comment: "passive",
  digest: "passive",
  info: "passive",
};

/** An absolute link into this app when its public address is known, otherwise the bare path. */
export function linkTo(appUrl: string | null, path: string | null): string {
  const target =
    path && path.startsWith("/") && !path.startsWith("//") ? path : "/";
  return appUrl ? `${appUrl}${target}` : target;
}

/** The tag that makes a newer notification about the same thing replace the old one. */
export function tagOf(notification: DeliverableNotification): string {
  return notification.taskId
    ? `hw-task-${notification.taskId}`
    : `hw-n-${notification.id}`;
}

/**
 * The service data for `notify.<target>`: title and text in the recipient's
 * language (rendered from the stored message key and parameters), a link into
 * the app, one tag per task, and a "done" button per action the core minted
 * (`HW_DONE_<token>`, posted back to the app by the smart-home system).
 */
export function renderPush(input: {
  notification: DeliverableNotification;
  locale: UserLocale;
  appUrl: string | null;
  actions: ChannelAction[];
}): NotificationPayload {
  const { notification, locale } = input;
  const params = localizedParams(notification.params, locale);
  const message = (
    (m as unknown as Record<string, Render>)[notification.titleKey] ??
    (() => "")
  )(params, { locale });
  const title = (TITLES[notification.kind] ?? TITLES.info)({}, { locale });
  return buildActionableNotification({
    title,
    message,
    url: linkTo(input.appUrl, notification.url),
    tag: tagOf(notification),
    actions: input.actions
      .filter((a) => a.kind === "complete")
      .map((a) => ({
        action: notificationActionToken(ACTION_DONE_PREFIX, a.id),
        title: m.push_action_done({}, { locale }),
      })),
    interruptionLevel: LEVELS[notification.kind] ?? "active",
  });
}
