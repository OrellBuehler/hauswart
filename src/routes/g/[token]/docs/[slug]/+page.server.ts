import { error } from "@sveltejs/kit";
import { getDB } from "$lib/server/db";
import { getGuestPage } from "$lib/server/share/guest-view";
import { recordGuestView } from "$lib/server/share/guest-links";
import {
  GUEST_ERRORS,
  guestGate,
  unlockAction,
} from "$lib/server/share/guest-http";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async (event) => {
  const { token, slug } = event.params;
  const access = guestGate(event, token);
  if (access.state === "locked") {
    return { locked: true as const, locale: access.link.locale };
  }
  const db = getDB();
  const page = await getGuestPage({ db }, access.link, token, slug);
  if (!page) error(404, GUEST_ERRORS.page);
  recordGuestView({ db, now: Date.now() }, access.link);
  return {
    locked: false as const,
    token,
    locale: access.link.locale,
    secrets: access.link.includeSecrets,
    page,
  };
};

export const actions: Actions = { default: unlockAction };
