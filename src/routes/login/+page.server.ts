import { redirect } from "@sveltejs/kit";
import { safeRedirectTo } from "$lib/server/auth/routing";
import { countUsers } from "$lib/server/users/users";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals, url }) => {
  const redirectTo = safeRedirectTo(url.searchParams.get("redirectTo"));
  if (locals.user) redirect(303, redirectTo);
  if (countUsers() === 0) redirect(303, "/setup");
  return { redirectTo };
};
