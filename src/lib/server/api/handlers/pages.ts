import type { endpoints } from "$lib/api/registry";
import { rateLimitedError } from "$lib/server/api/errors";
import { previewRequestLimiter } from "$lib/server/auth/rate-limit";
import {
  createPage,
  deletePage,
  getPageDetail,
  getRevision,
  listPages,
  listRevisions,
  restoreRevision,
  updatePage,
} from "$lib/server/docs/pages";
import { renderPreview } from "$lib/server/docs/render";
import type { Handler } from "../bind";
import {
  wirePage,
  wirePageSummary,
  wireRevision,
  wireRevisionSummary,
} from "../wire";

export const list: Handler<typeof endpoints.pagesList> = ({ ctx, query }) => {
  const { cursor, limit, ...filter } = query;
  const page = listPages(ctx, filter, { cursor, limit });
  return {
    items: page.items.map(wirePageSummary),
    nextCursor: page.nextCursor,
  };
};

export const create: Handler<typeof endpoints.pagesCreate> = async ({
  ctx,
  body,
}) => wirePage(await createPage(ctx, body, ctx.user.id));

export const get: Handler<typeof endpoints.pagesGet> = ({ ctx, params }) =>
  wirePage(getPageDetail(ctx, params.slug));

export const update: Handler<typeof endpoints.pagesUpdate> = async ({
  ctx,
  params,
  body,
}) => wirePage(await updatePage(ctx, params.slug, body, ctx.user.id));

export const remove: Handler<typeof endpoints.pagesDelete> = ({
  ctx,
  params,
}) => {
  deletePage(ctx, params.slug);
  return null;
};

export const revisions: Handler<typeof endpoints.pageRevisionsList> = ({
  ctx,
  params,
}) => ({ items: listRevisions(ctx, params.slug).map(wireRevisionSummary) });

export const revision: Handler<typeof endpoints.pageRevisionsGet> = ({
  ctx,
  params,
}) => wireRevision(getRevision(ctx, params.slug, params.rev));

export const restore: Handler<typeof endpoints.pageRevisionsRestore> = async ({
  ctx,
  params,
}) =>
  wirePage(await restoreRevision(ctx, params.slug, params.rev, ctx.user.id));

export const preview: Handler<typeof endpoints.pagesPreview> = async ({
  ctx,
  body,
}) => {
  const hit = previewRequestLimiter.hit(ctx.user.id);
  if (!hit.allowed) throw rateLimitedError(hit.retryAfterMs);
  return renderPreview(ctx, body.bodyMd);
};
