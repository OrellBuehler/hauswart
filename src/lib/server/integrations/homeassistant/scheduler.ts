import { getDB } from "$lib/server/db";
import { onEvent } from "$lib/server/events";
import { KIND } from "./connection";
import { clearEntityCache } from "./adapter";
import { pollStates, syncCalendars } from "./sync";

export const POLL_INTERVAL_MS = 60_000;
export const CALENDAR_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 20_000;
const KICK_DELAY_MS = 1_500;

export interface SchedulerOptions {
  pollIntervalMs?: number;
  calendarIntervalMs?: number;
  firstRunDelayMs?: number;
  /** Wait this long after a change before reading, so a burst of edits causes one read. */
  kickDelayMs?: number;
  clock?: () => number;
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "NonError";
}

/**
 * Keeps the readings current: every minute the states of what is watched,
 * every six hours the calendars (and at once when a new calendar becomes
 * watched). A saved task, preparation or hint reaction that adds something to
 * watch, and a changed connection, trigger a read after a short pause instead
 * of waiting for the next tick, so a new task has its baseline within
 * seconds. Runs never overlap (a request during a run is run once more
 * afterwards), a failing run is logged and tried again at the next tick,
 * failures back off in `pollStates`, the timers do not keep the process
 * alive; the returned function stops everything.
 */
export function startHomeAssistantScheduler(
  options: SchedulerOptions = {},
): () => void {
  const clock = options.clock ?? Date.now;
  const lastSynced = new Map<string, number>();
  let running = false;
  let again: { force: boolean } | null = null;

  const run = async (request: {
    calendars: "all" | "missing";
    ignoreBackoff: boolean;
    poll: boolean;
  }): Promise<void> => {
    if (running) {
      again = { force: again?.force || request.ignoreBackoff };
      return;
    }
    running = true;
    try {
      const ctx = { db: getDB(), now: clock() };
      if (request.poll) {
        await pollStates(ctx, { ignoreBackoff: request.ignoreBackoff });
      }
      await syncCalendars(
        { ...ctx, now: clock() },
        {
          lastSynced,
          ignoreBackoff: request.ignoreBackoff,
          ...(request.calendars === "missing"
            ? { maxAgeMs: CALENDAR_INTERVAL_MS }
            : {}),
        },
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "homeassistant.scheduler_failed",
          name: errorName(err),
        }),
      );
    } finally {
      running = false;
      const next = again;
      again = null;
      if (next) {
        void run({
          calendars: "missing",
          ignoreBackoff: next.force,
          poll: true,
        });
      }
    }
  };

  const poll = () =>
    void run({ calendars: "missing", ignoreBackoff: false, poll: true });
  const calendars = () =>
    void run({ calendars: "all", ignoreBackoff: false, poll: false });

  let kickTimer: ReturnType<typeof setTimeout> | null = null;
  const kick = (ignoreBackoff: boolean) => {
    if (kickTimer) clearTimeout(kickTimer);
    kickTimer = setTimeout(() => {
      kickTimer = null;
      if (ignoreBackoff) lastSynced.clear();
      void run({ calendars: "missing", ignoreBackoff, poll: true });
    }, options.kickDelayMs ?? KICK_DELAY_MS);
    kickTimer.unref?.();
  };

  const first = setTimeout(poll, options.firstRunDelayMs ?? FIRST_RUN_DELAY_MS);
  const pollTimer = setInterval(
    poll,
    options.pollIntervalMs ?? POLL_INTERVAL_MS,
  );
  const calendarTimer = setInterval(
    calendars,
    options.calendarIntervalMs ?? CALENDAR_INTERVAL_MS,
  );
  first.unref?.();
  pollTimer.unref?.();
  calendarTimer.unref?.();

  const offNeeds = onEvent("signalNeedsChanged", () => kick(false));
  const offConnection = onEvent("connectionChanged", ({ kind }) => {
    if (kind !== KIND) return;
    clearEntityCache();
    kick(true);
  });

  return () => {
    clearTimeout(first);
    clearInterval(pollTimer);
    clearInterval(calendarTimer);
    if (kickTimer) clearTimeout(kickTimer);
    offNeeds();
    offConnection();
  };
}
