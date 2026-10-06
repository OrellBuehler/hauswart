import { createApiClient } from "$lib/api/client";
import { isApiError } from "$lib/api/errors";
import { fetchAll } from "$lib/api/fetch-all";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import { sortTasks } from "$lib/assets/tasks";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, params, url }) => {
  const api = createApiClient(fetch);
  let asset;
  try {
    asset = await api.call(endpoints.assetsByQr, {
      params: { qrSlug: params.slug },
    });
  } catch (err) {
    if (
      isApiError(err) &&
      (err.code === "not_found" || err.code === "invalid_request")
    ) {
      return { slug: params.slug, found: null };
    }
    return orFail(Promise.reject(err), url.pathname);
  }
  const [taskList, hints] = await orFail(
    Promise.all([
      fetchAll((cursor) =>
        api.call(endpoints.tasksList, {
          query: { cursor, limit: 200, assetId: asset.id },
        }),
      ),
      fetchAll((cursor) =>
        api.call(endpoints.assetHintsList, {
          params: { id: asset.id },
          query: { cursor, limit: 200 },
        }),
      ),
    ]),
    url.pathname,
  );
  const tasks = sortTasks(taskList);
  const details = await orFail(
    Promise.all(
      tasks.map((task) =>
        api.call(endpoints.tasksGet, { params: { id: task.id } }),
      ),
    ),
    url.pathname,
  );
  const completions = details
    .flatMap((detail) => detail.recentCompletions)
    .filter((completion) => completion.kind === "done" && !completion.revokedAt)
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
    .slice(0, 5);
  return { slug: params.slug, found: { asset, tasks, completions, hints } };
};
