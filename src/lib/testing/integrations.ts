import type { DB } from "#lib/server/db.ts";
import { updateHousehold } from "#lib/server/household/household.ts";

/** Puts hosts on the household's integration allow-list, so members may connect to them. */
export function allowIntegrationHosts(db: DB, ...hosts: string[]): void {
  updateHousehold({ db }, { settings: { integrationHostAllowlist: hosts } });
}
