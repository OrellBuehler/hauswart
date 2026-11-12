import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { create, list } from "#lib/server/api/handlers/comments.ts";

export const GET = bind(endpoints.commentsList, list);
export const POST = bind(endpoints.commentsCreate, create);
