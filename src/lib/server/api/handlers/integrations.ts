import type { z } from "zod";
import { INTEGRATION_LEVELS, type IntegrationKind } from "$lib/api/enums";
import type { endpoints } from "$lib/api/registry";
import type { integrationSchema } from "$lib/api/schemas/integrations";
import { toIso } from "$lib/api/schemas/common";
import { requireAdmin } from "$lib/server/auth/guards";
import {
  deleteConnection,
  listConnectionViews,
  ownerFor,
  runOperation,
  saveConnection,
  testConnection,
  toView,
  type ConnectionView,
} from "$lib/server/connections/connections";
import type { Handler } from "../bind";
import type { AuthedContext } from "../context";

const isAdmin = (ctx: AuthedContext) => ctx.principal.scopes.includes("admin");

/** The owner id for a kind, after checking that the caller may change it: household connections are administrators' business. */
function writableOwner(ctx: AuthedContext, kind: IntegrationKind) {
  if (INTEGRATION_LEVELS[kind] === "household") requireAdmin(ctx.principal);
  return ownerFor(kind, ctx.user.id);
}

export function wireIntegration(
  view: ConnectionView,
): z.input<typeof integrationSchema> {
  return {
    kind: view.kind,
    level: view.level,
    available: view.available,
    capabilities: view.capabilities,
    configured: view.configured,
    enabled: view.enabled,
    baseUrl: view.baseUrl,
    allowInsecureTls: view.allowInsecureTls,
    config: view.config,
    status: view.status,
    lastError: view.lastError,
    lastOkAt: view.lastOkAt ? toIso(view.lastOkAt) : null,
    lastCheckedAt: view.lastCheckedAt ? toIso(view.lastCheckedAt) : null,
    consecutiveFailures: view.consecutiveFailures,
  };
}

export const list: Handler<typeof endpoints.integrationsList> = ({ ctx }) => ({
  items: listConnectionViews(ctx, ctx.user.id, { isAdmin: isAdmin(ctx) }).map(
    wireIntegration,
  ),
  nextCursor: null,
});

export const save: Handler<typeof endpoints.integrationsSave> = ({
  ctx,
  params,
  body,
}) => {
  const owner = writableOwner(ctx, params.kind);
  const row = saveConnection(ctx, params.kind, owner, {
    baseUrl: body.baseUrl,
    token: body.token,
    allowInsecureTls: body.allowInsecureTls,
    config: body.config,
    enabled: body.enabled,
  });
  return wireIntegration(toView(params.kind, row, { showAddress: true }));
};

export const remove: Handler<typeof endpoints.integrationsDelete> = ({
  ctx,
  params,
}) => {
  deleteConnection(ctx, params.kind, writableOwner(ctx, params.kind));
  return null;
};

export const test: Handler<typeof endpoints.integrationsTest> = async ({
  ctx,
  params,
}) => {
  const owner = writableOwner(ctx, params.kind);
  const { result, view } = await testConnection(ctx, params.kind, owner, {
    showAddress: true,
  });
  return {
    ok: result.ok,
    error: result.error ?? null,
    info: result.info ?? null,
    integration: wireIntegration(view),
  };
};

function operation(name: string) {
  return (
    ctx: AuthedContext,
    kind: IntegrationKind,
    query: Record<string, string> = {},
  ) => runOperation(ctx, kind, ownerFor(kind, ctx.user.id), name, query);
}

const entitiesOf = operation("entities");
const notifyServicesOf = operation("notify-services");
const calendarsOf = operation("calendars");
const devicesOf = operation("devices");

export const entities: Handler<typeof endpoints.integrationsEntities> = async ({
  ctx,
  params,
  query,
}) =>
  (await entitiesOf(ctx, params.kind, {
    ...(query.q ? { q: query.q } : {}),
    ...(query.domain ? { domain: query.domain } : {}),
    limit: String(query.limit),
  })) as never;

export const notifyServices: Handler<
  typeof endpoints.integrationsNotifyServices
> = async ({ ctx, params }) =>
  (await notifyServicesOf(ctx, params.kind)) as never;

export const calendars: Handler<
  typeof endpoints.integrationsCalendars
> = async ({ ctx, params }) => (await calendarsOf(ctx, params.kind)) as never;

export const devices: Handler<typeof endpoints.integrationsDevices> = async ({
  ctx,
  params,
}) => (await devicesOf(ctx, params.kind)) as never;

const tagsOf = operation("tags");
const correspondentsOf = operation("correspondents");
const customFieldsOf = operation("custom-fields");
const groupsOf = operation("groups");
const storagePathsOf = operation("storage-paths");

const pickerQuery = (query: { q?: string }): Record<string, string> =>
  query.q ? { q: query.q } : {};

export const tags: Handler<typeof endpoints.integrationsTags> = async ({
  ctx,
  params,
  query,
}) => (await tagsOf(ctx, params.kind, pickerQuery(query))) as never;

export const correspondents: Handler<
  typeof endpoints.integrationsCorrespondents
> = async ({ ctx, params, query }) =>
  (await correspondentsOf(ctx, params.kind, pickerQuery(query))) as never;

export const customFields: Handler<
  typeof endpoints.integrationsCustomFields
> = async ({ ctx, params, query }) =>
  (await customFieldsOf(ctx, params.kind, pickerQuery(query))) as never;

export const groups: Handler<typeof endpoints.integrationsGroups> = async ({
  ctx,
  params,
  query,
}) => (await groupsOf(ctx, params.kind, pickerQuery(query))) as never;

export const storagePaths: Handler<
  typeof endpoints.integrationsStoragePaths
> = async ({ ctx, params, query }) =>
  (await storagePathsOf(ctx, params.kind, pickerQuery(query))) as never;
