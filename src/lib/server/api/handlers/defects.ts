import type { endpoints } from "$lib/api/registry";
import {
  addEvent,
  changeStatus,
  createDefect,
  deleteDefect,
  getDefectDetail,
  getTimeline,
  listDefects,
  updateDefect,
} from "$lib/server/defects/defects";
import { exportDefectsPdf } from "$lib/server/defects/pdf";
import type { Handler } from "../bind";
import {
  wireDefect,
  wireDefectDetail,
  wireDefectEvent,
  wireTimelineItem,
} from "../wire";

export const list: Handler<typeof endpoints.defectsList> = ({ ctx, query }) => {
  const { cursor, limit, ...filter } = query;
  const page = listDefects(ctx, filter, { cursor, limit });
  return { items: page.items.map(wireDefect), nextCursor: page.nextCursor };
};

export const create: Handler<typeof endpoints.defectsCreate> = async ({
  ctx,
  body,
}) => wireDefect(await createDefect(ctx, body, ctx.user.id));

export const get: Handler<typeof endpoints.defectsGet> = ({ ctx, params }) =>
  wireDefectDetail(getDefectDetail(ctx, params.id));

export const update: Handler<typeof endpoints.defectsUpdate> = async ({
  ctx,
  params,
  body,
}) => wireDefect(await updateDefect(ctx, params.id, body));

export const remove: Handler<typeof endpoints.defectsDelete> = ({
  ctx,
  params,
}) => {
  deleteDefect(ctx, params.id);
  return null;
};

export const status: Handler<typeof endpoints.defectsStatus> = async ({
  ctx,
  params,
  body,
}) => wireDefectDetail(await changeStatus(ctx, params.id, body, ctx.user.id));

export const addCorrespondence: Handler<typeof endpoints.defectsAddEvent> = ({
  ctx,
  params,
  body,
}) => wireDefectEvent(addEvent(ctx, params.id, body, ctx.user.id));

export const timeline: Handler<typeof endpoints.defectsTimeline> = ({
  ctx,
  params,
}) => ({
  items: getTimeline(
    ctx,
    { id: ctx.user.id, role: ctx.user.role },
    params.id,
  ).map(wireTimelineItem),
});

export const exportPdf: Handler<typeof endpoints.defectsExport> = async ({
  ctx,
  query,
}) => {
  const bytes = await exportDefectsPdf(ctx, {
    filter: query,
    locale: ctx.user.locale,
  });
  return new Response(bytes, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="defects-${ctx.today}.pdf"`,
    },
  });
};
