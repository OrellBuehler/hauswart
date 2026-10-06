import { getDB } from "$lib/server/db";
import { getGuestHome } from "$lib/server/share/guest-view";
import { recordGuestView } from "$lib/server/share/guest-links";
import { guestGate, unlockAction } from "$lib/server/share/guest-http";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async (event) => {
  const { token } = event.params;
  const access = guestGate(event, token);
  if (access.state === "locked") {
    return { locked: true as const, locale: access.link.locale };
  }
  const db = getDB();
  recordGuestView({ db, now: Date.now() }, access.link);
  return {
    locked: false as const,
    token,
    locale: access.link.locale,
    secrets: access.link.includeSecrets,
    home: await getGuestHome({ db }, access.link, token),
  };
};

export const actions: Actions = { default: unlockAction };
