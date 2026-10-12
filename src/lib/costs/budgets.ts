import type { CostBudgetPeriod, CostCategory } from "$lib/api/enums";
import { isApiError } from "$lib/api/errors";
import {
  type CostBudget,
  type CostBudgetState,
  type CostBudgetStatusItem,
  type CreateCostBudgetRequest,
  type UpdateCostBudgetRequest,
} from "$lib/api/schemas/cost-budgets";
import { addMonths, formatDate, parseDate } from "$lib/dates";
import { monthName } from "$lib/format";
import { formatMoney } from "$lib/format-money";
import { currencyExponent, minor, toDecimalString } from "$lib/money";
import { m } from "$lib/paraglide/messages";
import { apiFieldErrors } from "$lib/tasks/field-errors";
import { parseDraftAmount, type BuiltBody } from "./form";
import { categoryLabels } from "./labels";

const MIN_YEAR = 1990;
const MAX_YEAR = 2200;

/** What the budgets page shows: the budgets of one period type, measured for one month or one year. */
export type BudgetView = {
  period: CostBudgetPeriod;
  year: number;
  /** 1 to 12; the month the monthly budgets are measured for (a year view keeps it for the way back). */
  month: number;
};

/** The view of an address (`?period=year&year=2025&month=3`); anything missing or wrong is today's month. */
export function parseBudgetView(
  params: URLSearchParams,
  today: string,
): BudgetView {
  const now = parseDate(today);
  const year = Number(params.get("year"));
  const month = Number(params.get("month"));
  return {
    period: params.get("period") === "year" ? "year" : "month",
    year:
      Number.isInteger(year) && year >= MIN_YEAR && year <= MAX_YEAR
        ? year
        : now.year,
    month:
      Number.isInteger(month) && month >= 1 && month <= 12 ? month : now.month,
  };
}

/** The query string for a view; what is today's is left out, so the plain address always shows the current month. */
export function budgetViewQuery(view: BudgetView, today: string): string {
  const now = parseDate(today);
  const params = new URLSearchParams();
  if (view.period === "year") params.set("period", "year");
  if (view.year !== now.year) params.set("year", String(view.year));
  if (view.month !== now.month) params.set("month", String(view.month));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** The view one month (or one year) on, or back; `null` beyond the years the API takes. */
export function shiftBudgetView(
  view: BudgetView,
  delta: -1 | 1,
): BudgetView | null {
  const next =
    view.period === "year"
      ? { ...view, year: view.year + delta }
      : (() => {
          const moved = parseDate(
            addMonths(formatDate(view.year, view.month, 1), delta),
          );
          return { ...view, year: moved.year, month: moved.month };
        })();
  return next.year < MIN_YEAR || next.year > MAX_YEAR ? null : next;
}

/** The query of `GET /costs/budgets/status`: both parts always go, the server uses the one a budget needs. */
export function budgetStatusQuery(view: BudgetView): {
  year: number;
  month: number;
} {
  return { year: view.year, month: view.month };
}

/** "Oktober 2026" for a month, "2026" for a year. */
export function budgetViewLabel(view: BudgetView): string {
  return view.period === "year"
    ? String(view.year)
    : `${monthName(view.month)} ${view.year}`;
}

/** Whether the view is the one that holds today. */
export function isCurrentView(view: BudgetView, today: string): boolean {
  const now = parseDate(today);
  return (
    view.year === now.year &&
    (view.period === "year" || view.month === now.month)
  );
}

const STATE_RANK: Record<CostBudgetState, number> = {
  exceeded: 0,
  warning: 1,
  ok: 2,
};

/** The statuses of one period type, the ones that need attention first, then the most used. */
export function itemsForPeriod(
  items: readonly CostBudgetStatusItem[],
  period: CostBudgetPeriod,
): CostBudgetStatusItem[] {
  return items
    .filter((item) => item.budget.period === period)
    .sort(
      (a, b) =>
        STATE_RANK[a.state] - STATE_RANK[b.state] ||
        b.percentUsed - a.percentUsed,
    );
}

/** How many budgets are close to or over their amount (all periods): what a hint on another page counts. */
export function budgetAlerts(
  items: readonly Pick<CostBudgetStatusItem, "state">[],
): {
  exceeded: number;
  warning: number;
} {
  return {
    exceeded: items.filter((item) => item.state === "exceeded").length,
    warning: items.filter((item) => item.state === "warning").length,
  };
}

/** "2 Budgets überschritten, 1 fast aufgebraucht"; empty while all budgets are within their amount. */
export function budgetAlertText(alerts: {
  exceeded: number;
  warning: number;
}): string {
  if (alerts.exceeded > 0 && alerts.warning > 0) {
    return m.budget_alert_both({
      exceeded: alerts.exceeded,
      warning: alerts.warning,
    });
  }
  if (alerts.exceeded > 0) {
    return m.budget_alert_exceeded({ count: alerts.exceeded });
  }
  if (alerts.warning > 0) {
    return m.budget_alert_warning({ count: alerts.warning });
  }
  return "";
}

export const budgetStateLabels: Record<CostBudgetState, () => string> = {
  ok: () => m.budget_state_ok(),
  warning: () => m.budget_state_warning(),
  exceeded: () => m.budget_state_exceeded(),
};

export const budgetPeriodLabels: Record<CostBudgetPeriod, () => string> = {
  month: () => m.budget_period_month(),
  year: () => m.budget_period_year(),
};

/** What a budget is for, as a title and a second line: the category and book, or one of them and "all of the other". */
export function budgetScope(
  budget: Pick<CostBudget, "bookName" | "category">,
): { title: string; subtitle: string } {
  if (budget.category) {
    return {
      title: categoryLabels[budget.category](),
      subtitle: budget.bookName ?? m.budget_all_books(),
    };
  }
  return {
    title: budget.bookName ?? m.budget_all_books(),
    subtitle: m.budget_all_categories(),
  };
}

export type BudgetDisplay = {
  state: CostBudgetState;
  stateLabel: string;
  /** 0 to 100: how full the bar is. A budget that is over its amount fills it, a net refund leaves it empty. */
  barPercent: number;
  /** The real percentage used, "85 %" or "130 %". */
  percentText: string;
  spentText: string;
  amountText: string;
  /** "Noch CHF 60.00" or "CHF 30.00 über dem Budget". */
  remainingText: string;
  /** One sentence for a screen reader and the bar's value text. */
  summary: string;
};

/** The words and numbers of a budget's status, in its own currency. State and percentage come from the server. */
export function budgetDisplay(item: CostBudgetStatusItem): BudgetDisplay {
  const currency = item.budget.currency;
  const percent = Math.max(0, item.percentUsed);
  const spentText = formatMoney(item.spentMinor, currency);
  const amountText = formatMoney(item.budget.amountMinor, currency);
  const remainingText =
    item.remainingMinor >= 0
      ? m.budget_remaining({
          amount: formatMoney(item.remainingMinor, currency),
        })
      : m.budget_over({ amount: formatMoney(-item.remainingMinor, currency) });
  const stateLabel = budgetStateLabels[item.state]();
  const percentText = m.budget_percent({ percent });
  return {
    state: item.state,
    stateLabel,
    barPercent: Math.min(100, percent),
    percentText,
    spentText,
    amountText,
    remainingText,
    summary: m.budget_summary({
      state: stateLabel,
      percent: percentText,
      spent: spentText,
      amount: amountText,
    }),
  };
}

/**
 * The costs page for the entries a budget measured: its book (every book without one), its category, and the month or
 * year it was measured for. The entries shown include those that do not count as an expense.
 */
export function budgetEntriesQuery(
  item: Pick<CostBudgetStatusItem, "budget" | "periodFrom">,
): string {
  const { year, month } = parseDate(item.periodFrom);
  const params = new URLSearchParams();
  params.set("book", item.budget.bookId ?? "all");
  params.set("year", String(year));
  if (item.budget.period === "month") {
    params.set("month", String(month).padStart(2, "0"));
  }
  if (item.budget.category) params.set("category", item.budget.category);
  return `?${params.toString()}`;
}

/** What the form edits. */
export type BudgetDraft = {
  /** Empty = every book. */
  bookId: string;
  /** Empty = every category. */
  category: CostCategory | "";
  period: CostBudgetPeriod;
  /** The amount as typed, in the household's currency. */
  amount: string;
  active: boolean;
};

export function newBudgetDraft(defaults: {
  bookId?: string | undefined;
  period?: CostBudgetPeriod | undefined;
}): BudgetDraft {
  return {
    bookId: defaults.bookId ?? "",
    category: "",
    period: defaults.period ?? "month",
    amount: "",
    active: true,
  };
}

export function draftFromBudget(budget: CostBudget): BudgetDraft {
  return {
    bookId: budget.bookId ?? "",
    category: budget.category ?? "",
    period: budget.period,
    amount: toDecimalString(
      minor(budget.amountMinor),
      currencyExponent(budget.currency),
    ),
    active: budget.active,
  };
}

function checkDraft(
  draft: BudgetDraft,
  currency: string,
): { errors: Record<string, string>; amountMinor: number | undefined } {
  const errors: Record<string, string> = {};
  if (draft.bookId === "" && draft.category === "") {
    errors.bookId = m.budget_error_scope();
  }
  const amount = parseDraftAmount(draft.amount, false, currency);
  if (!amount.ok) errors.amountMinor = amount.error;
  else if (amount.amountMinor < 0) errors.amountMinor = m.budget_error_amount();
  return { errors, amountMinor: amount.ok ? amount.amountMinor : undefined };
}

/** The request for a new budget, or the errors that stop it. */
export function buildBudgetCreateBody(
  draft: BudgetDraft,
  currency: string,
): BuiltBody<CreateCostBudgetRequest> {
  const { errors, amountMinor } = checkDraft(draft, currency);
  if (amountMinor === undefined || Object.keys(errors).length > 0) {
    return { body: undefined, errors };
  }
  return {
    body: {
      ...(draft.bookId ? { bookId: draft.bookId } : {}),
      ...(draft.category ? { category: draft.category } : {}),
      period: draft.period,
      amountMinor,
      active: draft.active,
    },
    errors,
  };
}

/** The request that changes `budget` into the draft, with only what differs; `null` takes a half of the scope away. */
export function buildBudgetUpdateBody(
  draft: BudgetDraft,
  budget: CostBudget,
  currency: string,
): BuiltBody<UpdateCostBudgetRequest> {
  const { errors, amountMinor } = checkDraft(
    draft,
    budget.currency || currency,
  );
  if (amountMinor === undefined || Object.keys(errors).length > 0) {
    return { body: undefined, errors };
  }
  const patch: UpdateCostBudgetRequest = {};
  if ((draft.bookId || null) !== budget.bookId) {
    patch.bookId = draft.bookId || null;
  }
  if ((draft.category || null) !== budget.category) {
    patch.category = draft.category || null;
  }
  if (draft.period !== budget.period) patch.period = draft.period;
  if (amountMinor !== budget.amountMinor) patch.amountMinor = amountMinor;
  if (draft.active !== budget.active) patch.active = draft.active;
  return { body: patch, errors };
}

/** Why a budget could not be saved, in words, per field; `undefined` for any other failure. */
export function budgetSaveErrors(
  err: unknown,
): Record<string, string> | undefined {
  if (!isApiError(err)) return undefined;
  if (err.code === "conflict") return { bookId: m.budget_error_exists() };
  if (err.code === "invalid_request") {
    const fields = apiFieldErrors(err);
    if ("bookId" in fields)
      return { ...fields, bookId: m.budget_error_scope() };
  }
  return undefined;
}
