import { error } from "@sveltejs/kit";
import { m } from "$lib/paraglide/messages";
import type { LayoutLoad } from "./$types";

export const load: LayoutLoad = async ({ parent }) => {
  const { user } = await parent();
  if (user.role !== "admin") error(403, m.error_page_forbidden_body());
};
