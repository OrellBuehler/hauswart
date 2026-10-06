import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { create, list } from "$lib/server/api/handlers/comments";

export const GET = bind(endpoints.commentsList, list);
export const POST = bind(endpoints.commentsCreate, create);
