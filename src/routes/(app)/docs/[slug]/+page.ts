import { createApiClient } from "$lib/api/client";
import { isApiError } from "$lib/api/errors";
import { loadHousehold } from "$lib/api/household";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import type { PageLoad } from "./$types";

/** A linked asset or room that is gone is just not shown; any other failure is a real error. */
async function orMissing<T>(call: Promise<T>): Promise<T | null> {
  try {
    return await call;
  } catch (err) {
    if (isApiError(err) && err.code === "not_found") return null;
    throw err;
  }
}

export const load: PageLoad = async ({ fetch, params, url }) => {
  const client = createApiClient(fetch);
  let page;
  try {
    page = await client.call(endpoints.pagesGet, {
      params: { slug: params.slug },
    });
  } catch (err) {
    if (isApiError(err) && err.code === "not_found") {
      return {
        slug: params.slug,
        page: null,
        asset: null,
        room: null,
        timeZone: undefined,
      };
    }
    return orFail(Promise.reject(err), url.pathname);
  }
  const [asset, room, household] = await orFail(
    Promise.all([
      page.assetId
        ? orMissing(
            client.call(endpoints.assetsGet, { params: { id: page.assetId } }),
          )
        : null,
      page.roomId
        ? orMissing(
            client.call(endpoints.roomsGet, { params: { id: page.roomId } }),
          )
        : null,
      loadHousehold(client),
    ]),
    url.pathname,
  );
  return {
    slug: params.slug,
    page,
    asset,
    room,
    timeZone: household.household.timezone as string | undefined,
  };
};
