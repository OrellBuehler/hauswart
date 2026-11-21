import { error } from "@sveltejs/kit";
import { m } from "#lib/paraglide/messages.js";
import type { PageLoad } from "./$types";

export const load: PageLoad = () => {
  error(404, m.error_page_not_found_body());
};
