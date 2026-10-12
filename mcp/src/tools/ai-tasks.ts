import { z } from "zod";
import {
  AI_TASK_KINDS,
  AI_TASK_STATUSES,
  COST_CATEGORIES,
} from "../../../src/lib/api/enums";
import { isApiError } from "../../../src/lib/api/errors";
import { endpoints } from "../../../src/lib/api/registry";
import {
  AI_TASK_PDF_READ_MAX_BYTES,
  type AiTask,
} from "../../../src/lib/api/schemas/ai-tasks";
import type { FinanceSuggestion } from "../../../src/lib/api/schemas/finance";
import { addDays } from "../../../src/lib/dates";
import type { ToolContext } from "../context";
import { ToolError } from "../errors";
import { moreHint, plural } from "../format";
import { defineTool, type ToolContent } from "../tool";
import { money } from "./costs";

const taskId = z
  .string()
  .min(1)
  .max(64)
  .describe("Task id, from list_ai_tasks");

/** A PDF larger than this is not embedded in the result (base64 grows it by a third); the task is dismissed instead. */
export const PDF_EMBED_MAX_BYTES = AI_TASK_PDF_READ_MAX_BYTES;
/** How far back the bank transactions offered for a receipt reach, and how many. */
export const TRANSACTION_WINDOW_DAYS = 30;
export const TRANSACTION_LIMIT = 20;

const filePath = (task: AiTask) =>
  task.attachment ? `/api/v1/attachments/${task.attachment.id}/content` : null;

/** The lease on a pending task as the model reads it: who holds it (`you` or a name) and for how long yet. */
function claimRow(task: AiTask, ctx: ToolContext) {
  const claim = task.claim;
  if (!claim) return null;
  return {
    by: claim.byUserId === ctx.me.id ? "you" : (claim.byName ?? "somebody"),
    minutesLeft: Math.max(
      0,
      Math.ceil((Date.parse(claim.expiresAt) - ctx.now()) / 60_000),
    ),
  };
}

/** One task as the model reads it. */
function taskRow(task: AiTask, ctx: ToolContext) {
  return {
    id: task.id,
    kind: task.kind,
    status: task.status,
    note: task.note,
    uploadedBy: task.createdByName,
    uploadedById: task.createdByUserId,
    uploadedAt: task.createdAt,
    hintBook: task.bookName,
    hintAsset: task.assetName,
    claim: claimRow(task, ctx),
    file: task.attachment
      ? { filename: task.attachment.filename, mime: task.attachment.mime }
      : null,
    bookedAs: task.result
      ? task.result.costs.map((c) => ({
          id: c.id,
          title: c.title,
          amount: money(c.amountMinor, c.currency),
          needsReview: c.reviewNeeded ? true : null,
        }))
      : null,
    bookedSoFar: task.bookedSoFar.length
      ? task.bookedSoFar.map((c) => ({
          id: c.id,
          title: c.title,
          amount: money(c.amountMinor, c.currency),
          needsReview: c.reviewNeeded ? true : null,
          fuelLogId: c.fuelLogId,
        }))
      : null,
    resultNote: task.result?.note,
    dismissReason: task.dismissReason,
    closedAt: task.completedAt,
    closedVia: task.completedVia,
    closedBy: task.completedByName,
  };
}

export const listAiTasks = defineTool({
  name: "list_ai_tasks",
  title: "List the receipt queue",
  description:
    "The household's receipt queue: files (photos of receipts, invoices as PDF) that somebody uploaded in the app for you to read and book. Every member sees every task. Default: the tasks waiting to be processed (status pending), newest first. Each row has the uploader (booked costs are paid by them unless the receipt says otherwise), their note and the book and device they hinted at. Open one with get_ai_task to see the receipt itself, then book it and close it with complete_ai_task or dismiss_ai_task.",
  mode: "read",
  input: {
    status: z.enum(AI_TASK_STATUSES).default("pending"),
    kind: z.enum(AI_TASK_KINDS).optional(),
    limit: z.number().int().min(1).max(100).default(30),
    cursor: z.string().min(1).max(512).optional(),
  },
  async handler(args, ctx) {
    const page = await ctx.api.call(endpoints.aiTasksList, { query: args });
    const what = args.status === "pending" ? "waiting" : args.status;
    return {
      summary: `${plural(page.items.length, "task")} ${what}.${moreHint(page.nextCursor)}`,
      data: {
        tasks: page.items.map((task) => taskRow(task, ctx)),
        nextCursor: page.nextCursor,
      },
    };
  },
});

/** `a moment ago`, `3 minutes ago`. */
function ago(at: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(at)) / 60_000);
  return minutes < 1 ? "a moment ago" : `${plural(minutes, "minute")} ago`;
}

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

interface FileResult {
  blocks: ToolContent[];
  /** What the text says about the file. */
  file: Record<string, unknown>;
}

/** What to do with a PDF that is too large to be handed over: not guess, but hand the task back with a reason. */
const tooLargePdf = (bytes: number) =>
  `The PDF is too large to attach (${bytes} bytes, more than 4 MB) and cannot be read through this connection. Do not guess at its contents: close the task with dismiss_ai_task and the reason "PDF zu gross", so the uploader sends a photo of the receipt instead.`;

/** The task's file for the model: an image block, a PDF as an embedded document, or a note saying why not. */
async function fileOf(ctx: ToolContext, task: AiTask): Promise<FileResult> {
  const attachment = task.attachment;
  const path = filePath(task);
  if (!attachment || !path) {
    return {
      blocks: [],
      file: { problem: "The task has no file any more." },
    };
  }
  const base = {
    filename: attachment.filename,
    mime: attachment.mime,
    originalSize: attachment.size,
    originalPixels:
      attachment.width && attachment.height
        ? `${attachment.width}x${attachment.height}`
        : null,
  };
  if (
    attachment.mime === "application/pdf" &&
    attachment.size > PDF_EMBED_MAX_BYTES
  ) {
    return {
      blocks: [],
      file: {
        ...base,
        delivered: "none",
        problem: tooLargePdf(attachment.size),
      },
    };
  }
  let res: Response;
  try {
    res = await ctx.api.call(endpoints.aiTasksPreview, {
      params: { id: task.id },
    });
  } catch (err) {
    if (isApiError(err) && err.code === "not_found") {
      return {
        blocks: [],
        file: { ...base, problem: "The file is missing on the server." },
      };
    }
    throw err;
  }
  const mimeType = res.headers.get("content-type") ?? attachment.mime;
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (mimeType === "application/pdf") {
    if (bytes.byteLength > PDF_EMBED_MAX_BYTES) {
      return {
        blocks: [],
        file: {
          ...base,
          delivered: "none",
          problem: tooLargePdf(bytes.byteLength),
        },
      };
    }
    return {
      blocks: [
        {
          type: "resource",
          resource: {
            uri: `hauswart://ai-tasks/${task.id}/${encodeURIComponent(attachment.filename)}`,
            mimeType,
            blob: toBase64(bytes),
          },
        },
      ],
      file: { ...base, delivered: "pdf", download: path },
    };
  }
  return {
    blocks: [{ type: "image", data: toBase64(bytes), mimeType }],
    file: {
      ...base,
      delivered: "image",
      deliveredSize: bytes.byteLength,
      scaledDown: bytes.byteLength !== attachment.size ? true : null,
      download: path,
    },
  };
}

/** The pending bank transactions of the uploader that could be this receipt's payment; only the uploader's own inbox is theirs to read. */
async function transactionsFor(ctx: ToolContext, task: AiTask) {
  if (task.createdByUserId !== ctx.me.id) {
    return {
      note: "The uploader's bank transactions are private to them, so they are not listed. Ask the uploader to process the receipt if a transaction may cover it.",
    };
  }
  const since = addDays(ctx.today(), -TRANSACTION_WINDOW_DAYS);
  try {
    const page = await ctx.api.call(endpoints.financeSuggestionsList, {
      query: { kind: "cost", status: "pending", limit: 100 },
    });
    const recent = page.items
      .filter(
        (s): s is Extract<FinanceSuggestion, { kind: "cost" }> =>
          s.kind === "cost" && s.payload.date >= since,
      )
      .sort((a, b) => b.payload.date.localeCompare(a.payload.date))
      .slice(0, TRANSACTION_LIMIT);
    return {
      note: recent.length
        ? "If the receipt is one of these payments, book it with accept_finance_suggestion (not create_cost) so it is booked once."
        : null,
      list: recent.map((s) => ({
        suggestionId: s.id,
        date: s.payload.date,
        amount: money(s.payload.amountMinor, s.payload.currency),
        payee: s.payload.payee,
        title: s.payload.title,
        category: s.payload.category,
      })),
    };
  } catch (err) {
    if (!isApiError(err)) throw err;
    return { note: `The bank transactions could not be read (${err.code}).` };
  }
}

export const getAiTask = defineTool({
  name: "get_ai_task",
  title: "Open a receipt task",
  description:
    "Opens one task of the receipt queue: its note and hints, the receipt itself (an image scaled to at most 1600 px, which is plenty to read it; a PDF is attached as a document up to 4 MB; a larger one cannot be read here: dismiss the task with the reason \"PDF zu gross\") and what you need to book it: the open cost books (default, tax relevant), the cost categories, the household members with their ownership shares, the vehicles and, when you are the uploader, their recent pending bank transactions (any of them may be the same payment). How to work: read the receipt; book it with create_cost (several entries when it mixes books or categories; add_fuel_log for the fuel receipt of a vehicle; accept_finance_suggestion when a listed bank transaction is the payment) and pass this task's id as receiptTaskId every time, so that what you book is recorded on the task and flagged for review at once; bookedSoFar lists what is recorded already (by an earlier attempt of yours or by somebody else's client): do not book those again; the uploader pays unless the note or the receipt says otherwise (paidBy); use the uploader's hints for book and asset when they fit; then close the task with complete_ai_task and the ids of everything you booked. Every entry you book is flagged for a person to review, so say in complete_ai_task's note what you were unsure of. A file that is no receipt, unreadable or already booked (check list_costs) is closed with dismiss_ai_task and a reason. Look before you book: a task that is not pending was processed already. Opening a task marks it as being worked on by you for 15 minutes (a soft lease, shown as claim): when another member's client opened it recently the answer starts with a warning, because that client may be booking the same receipt right now; nothing is locked.",
  mode: "read",
  input: { id: taskId },
  async handler({ id }, ctx) {
    // Opening a task marks it as being worked on (a soft lease); a token that cannot write only looks.
    const task = await ctx.api.call(
      ctx.scopes.includes("costs:write")
        ? endpoints.aiTasksClaim
        : endpoints.aiTasksGet,
      { params: { id } },
    );
    const [file, books, people, vehicles, transactions] = await Promise.all([
      fileOf(ctx, task),
      ctx.api.call(endpoints.costBooksList, { query: { limit: 200 } }),
      ctx.api.call(endpoints.usersDirectory),
      ctx.api.call(endpoints.assetsList, {
        query: { kind: "vehicle", limit: 200 },
      }),
      transactionsFor(ctx, task),
    ]);
    const uploader = task.createdByName ?? "nobody";
    const when = task.createdAt.slice(0, 10);
    const booked = task.bookedSoFar.length;
    const state =
      task.status === "pending"
        ? booked
          ? ` ${plural(booked, "cost entry", "cost entries")} ${booked === 1 ? "was" : "were"} booked for this task already (bookedSoFar): do not book ${booked === 1 ? "it" : "them"} again, book only what is missing.`
          : ""
        : ` It is ${task.status} already${task.status === "done" ? ": do not book it again" : ""}.`;
    const rival =
      task.claim && task.claim.byUserId !== ctx.me.id ? task.claim : null;
    const warning = rival
      ? `Warning: ${rival.byName ?? "Another member"}'s client opened this task ${ago(rival.at, ctx.now())} and may be booking it right now. Look at bookedSoFar and list_costs before you book anything, do not book what is listed there again, and think twice before working on it in parallel. `
      : "";
    return {
      summary: `${warning}Receipt task ${task.id} (${task.status}), uploaded by ${uploader} on ${when}${
        task.note ? `: "${task.note}"` : ""
      }.${state}${
        file.blocks.length
          ? " The receipt follows as attached content."
          : " No receipt could be attached (see file)."
      }`,
      data: {
        task: taskRow(task, ctx),
        file: file.file,
        defaults: {
          paidBy: uploader,
          paidById: task.createdByUserId,
          currency: ctx.household.currency,
          today: ctx.today(),
        },
        books: books.items.map((b) => ({
          id: b.id,
          name: b.name,
          taxRelevant: b.taxRelevant ? true : null,
          default: b.isDefault ? true : null,
          defaultSplit: b.defaultSplitMode,
        })),
        categories: COST_CATEGORIES,
        members: people.items.map((p) => ({
          id: p.id,
          name: p.displayName,
          ownershipPercent: p.ownershipBps / 100,
          uploader: p.id === task.createdByUserId ? true : null,
          you: p.id === ctx.me.id ? true : null,
        })),
        vehicles: vehicles.items.map((v) => ({
          id: v.id,
          name: v.name,
          plate: v.vehicle?.plate,
        })),
        bankTransactions: transactions.list,
        bankTransactionsNote: transactions.note,
      },
      content: file.blocks,
    };
  },
});

const ids = (what: string) =>
  z.array(z.string().min(1).max(64)).max(20).optional().describe(what);

export const completeAiTask = defineTool({
  name: "complete_ai_task",
  title: "Finish a receipt task",
  description:
    "Closes a receipt task as done once you have booked what it shows: costIds are the cost entries you created for it (create_cost, accept_finance_suggestion), fuelLogIds the fuel log entries (add_fuel_log); at least one. All of them must exist. The receipt moves onto the first cost entry (the others get a copy) and every entry is flagged for a person to review. note is for those people: what you were unsure of (a date you guessed, a category you chose, an item you could not read). Entries booked for this task (receiptTaskId) are always accepted; an entry that existed before the task was queued is refused (it is not what this receipt became: check list_costs, and dismiss the task if it was booked already), and so is one booked for another task. Repeating the call with the same ids changes nothing; with other ids it is a conflict, and so is a task that was dismissed. Nothing booked? Use dismiss_ai_task.",
  mode: "update",
  scopes: ["costs:write"],
  input: {
    id: taskId,
    costIds: ids("Ids of the cost entries you booked for this receipt"),
    fuelLogIds: ids("Ids of the fuel log entries you booked for this receipt"),
    note: z.string().trim().max(2000).optional(),
  },
  async handler({ id, costIds, fuelLogIds, note }, ctx) {
    if (!costIds?.length && !fuelLogIds?.length) {
      throw new ToolError(
        "invalid_request",
        "Give the ids of the cost entries (costIds) or fuel log entries (fuelLogIds) you booked for this receipt; use dismiss_ai_task when nothing was booked.",
      );
    }
    const task = await ctx.api.call(endpoints.aiTasksComplete, {
      params: { id },
      body: {
        createdCostIds: costIds,
        createdFuelLogIds: fuelLogIds,
        note,
      },
    });
    const booked = task.result?.costs ?? [];
    return {
      summary: `Task ${task.id} is done: ${plural(booked.length, "cost entry", "cost entries")} flagged for review.`,
      data: taskRow(task, ctx),
    };
  },
});

export const dismissAiTask = defineTool({
  name: "dismiss_ai_task",
  title: "Dismiss a receipt task",
  description:
    "Closes a receipt task without booking anything: the file is no receipt, cannot be read, or is booked already. reason (what the uploader will read) says why. The file stays with the task until somebody deletes it. Dismissing a dismissed task changes nothing; a task that is done is a conflict.",
  mode: "undo",
  scopes: ["costs:write"],
  input: {
    id: taskId,
    reason: z.string().trim().max(500).optional(),
  },
  async handler({ id, reason }, ctx) {
    const task = await ctx.api.call(endpoints.aiTasksDismiss, {
      params: { id },
      body: { reason },
    });
    return {
      summary: `Task ${task.id} is dismissed${task.dismissReason ? `: ${task.dismissReason}` : ""}.`,
      data: taskRow(task, ctx),
    };
  },
});

export const aiTaskTools = [
  listAiTasks,
  getAiTask,
  completeAiTask,
  dismissAiTask,
];
