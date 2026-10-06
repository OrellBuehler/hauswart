import type { endpoints } from "$lib/api/registry";
import {
  createGuestLink,
  listGuestLinks,
  revokeGuestLink,
  rotateGuestLink,
  updateGuestLink,
} from "$lib/server/share/guest-links";
import type { Handler } from "../bind";
import { guestLinkUrl, wireGuestLink } from "../wire-share";

export const list: Handler<typeof endpoints.guestLinksList> = ({ ctx }) => ({
  items: listGuestLinks(ctx).map(wireGuestLink),
  nextCursor: null,
});

export const create: Handler<typeof endpoints.guestLinksCreate> = async ({
  ctx,
  body,
  event,
}) => {
  const { record, token } = await createGuestLink(
    ctx,
    ctx.user.id,
    ctx.user.locale,
    body,
  );
  return {
    ...wireGuestLink(record),
    url: guestLinkUrl(event.url.origin, token),
  };
};

export const update: Handler<typeof endpoints.guestLinksUpdate> = async ({
  ctx,
  params,
  body,
}) => wireGuestLink(await updateGuestLink(ctx, params.id, body));

export const revoke: Handler<typeof endpoints.guestLinksRevoke> = ({
  ctx,
  params,
}) => {
  revokeGuestLink(ctx, params.id);
  return null;
};

export const rotate: Handler<typeof endpoints.guestLinksRotate> = ({
  ctx,
  params,
  event,
}) => {
  const { record, token } = rotateGuestLink(ctx, params.id);
  return {
    ...wireGuestLink(record),
    url: guestLinkUrl(event.url.origin, token),
  };
};
