import { redirect } from "@sveltejs/kit";
import { createApiClient } from "$lib/api/client";
import { endpoints } from "$lib/api/registry";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch }) => {
  const { needsSetup, tokenRequired } = await createApiClient(fetch).call(
    endpoints.setupStatus,
  );
  if (!needsSetup) redirect(303, "/login");
  return { tokenRequired };
};
