import type { endpoints } from "$lib/api/registry";
import {
  createContact,
  deleteContact,
  getContact,
  linkAssetContact,
  listAssetContacts,
  listContacts,
  unlinkAssetContact,
  updateContact,
} from "$lib/server/contacts/contacts";
import type { Handler } from "../bind";
import { wireAssetContact, wireContact } from "../wire";

export const list: Handler<typeof endpoints.contactsList> = ({
  ctx,
  query,
}) => {
  const { cursor, limit, ...filter } = query;
  const page = listContacts(ctx, filter, { cursor, limit });
  return { items: page.items.map(wireContact), nextCursor: page.nextCursor };
};

export const create: Handler<typeof endpoints.contactsCreate> = ({
  ctx,
  body,
}) => wireContact(createContact(ctx, body));

export const get: Handler<typeof endpoints.contactsGet> = ({ ctx, params }) =>
  wireContact(getContact(ctx, params.id));

export const update: Handler<typeof endpoints.contactsUpdate> = ({
  ctx,
  params,
  body,
}) => wireContact(updateContact(ctx, params.id, body));

export const remove: Handler<typeof endpoints.contactsDelete> = ({
  ctx,
  params,
}) => {
  deleteContact(ctx, params.id);
  return null;
};

export const listForAsset: Handler<typeof endpoints.assetContactsList> = ({
  ctx,
  params,
  query,
}) => {
  const page = listAssetContacts(ctx, params.id, query);
  return {
    items: page.items.map(wireAssetContact),
    nextCursor: page.nextCursor,
  };
};

export const link: Handler<typeof endpoints.assetContactsLink> = ({
  ctx,
  params,
  body,
}) => wireAssetContact(linkAssetContact(ctx, params.id, body));

export const unlink: Handler<typeof endpoints.assetContactsUnlink> = ({
  ctx,
  params,
}) => {
  unlinkAssetContact(ctx, params.id, params.linkId);
  return null;
};
