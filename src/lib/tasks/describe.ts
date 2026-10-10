import type { UserLocale } from "$lib/api/enums";
import { parseDate } from "$lib/dates";
import {
  formatDate,
  formatList,
  formatNumber,
  formatOrdinalDay,
  monthName,
  weekdayName,
} from "$lib/format";
import { m } from "$lib/paraglide/messages";
import { isOdometerKey } from "$lib/vehicles/odometer";
import type {
  CalendarTrigger,
  ConditionOp,
  IntervalTrigger,
  IntervalUnit,
  Season,
  Trigger,
} from "./engine/types";

const EVERY: Record<IntervalUnit, (n: number, locale: UserLocale) => string> = {
  day: (n, locale) => m.trigger_every_day({ n }, { locale }),
  week: (n, locale) => m.trigger_every_week({ n }, { locale }),
  month: (n, locale) => m.trigger_every_month({ n }, { locale }),
  year: (n, locale) => m.trigger_every_year({ n }, { locale }),
};

const OPS: Record<ConditionOp, (locale: UserLocale) => string> = {
  eq: (locale) => m.trigger_op_eq({}, { locale }),
  ne: (locale) => m.trigger_op_ne({}, { locale }),
  gt: (locale) => m.trigger_op_gt({}, { locale }),
  gte: (locale) => m.trigger_op_gte({}, { locale }),
  lt: (locale) => m.trigger_op_lt({}, { locale }),
  lte: (locale) => m.trigger_op_lte({}, { locale }),
};

const NTH: Record<number, (locale: UserLocale) => string> = {
  1: (locale) => m.trigger_nth_1({}, { locale }),
  2: (locale) => m.trigger_nth_2({}, { locale }),
  3: (locale) => m.trigger_nth_3({}, { locale }),
  4: (locale) => m.trigger_nth_4({}, { locale }),
  5: (locale) => m.trigger_nth_5({}, { locale }),
  [-1]: (locale) => m.trigger_nth_last_1({}, { locale }),
  [-2]: (locale) => m.trigger_nth_last_2({}, { locale }),
  [-3]: (locale) => m.trigger_nth_last_3({}, { locale }),
  [-4]: (locale) => m.trigger_nth_last_4({}, { locale }),
  [-5]: (locale) => m.trigger_nth_last_5({}, { locale }),
};

const PERIODS = {
  week: (locale: UserLocale) => m.trigger_period_week({}, { locale }),
  month: (locale: UserLocale) => m.trigger_period_month({}, { locale }),
  quarter: (locale: UserLocale) => m.trigger_period_quarter({}, { locale }),
  year: (locale: UserLocale) => m.trigger_period_year({}, { locale }),
};

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function months(values: number[], locale: UserLocale): string {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  return formatList(
    sorted.map((month) => monthName(month, "long", locale)),
    locale,
  );
}

function weekdays(values: number[], locale: UserLocale): string {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  return formatList(
    sorted.map((day) => weekdayName(day, "long", locale)),
    locale,
  );
}

/** The ISO weekday (1-7) a `YYYY-MM-DD` date falls on, without any time zone. */
function isoWeekdayOf(date: string): number {
  const { year, month, day } = parseDate(date);
  return ((new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7) + 1;
}

function describeInterval(t: IntervalTrigger, locale: UserLocale): string {
  const every = EVERY[t.unit](t.every, locale);
  const base =
    t.anchor === "completion"
      ? m.trigger_interval_completion({ every }, { locale })
      : m.trigger_interval_schedule(
          { every, date: formatDate(t.startDate, locale) },
          { locale },
        );
  const seasons = (t.seasons ?? []).map((s: Season) =>
    m.trigger_season(
      {
        from: monthName(s.fromMonth, "long", locale),
        to: monthName(s.toMonth, "long", locale),
        every: lowerFirst(EVERY[s.unit](s.every, locale)),
      },
      { locale },
    ),
  );
  return [base, ...seasons].join("; ");
}

function describeDay(t: CalendarTrigger, locale: UserLocale): string {
  if (t.nth !== undefined) {
    const days = t.byWeekday ?? [isoWeekdayOf(t.startDate)];
    return m.trigger_cal_nth(
      {
        nth: (NTH[t.nth] ?? NTH[1])(locale),
        weekday: weekdays(days, locale),
      },
      { locale },
    );
  }
  const day = t.byMonthDay ?? parseDate(t.startDate).day;
  return day < 0
    ? m.trigger_cal_day_last({ pos: String(-day) }, { locale })
    : m.trigger_cal_day({ day: formatOrdinalDay(day, locale) }, { locale });
}

function describeCalendar(t: CalendarTrigger, locale: UserLocale): string {
  if (t.freq === "weekly") {
    const days = weekdays(t.byWeekday ?? [isoWeekdayOf(t.startDate)], locale);
    return t.interval === 1
      ? m.trigger_cal_weekly_1({ days }, { locale })
      : m.trigger_cal_weekly_n({ n: t.interval, days }, { locale });
  }
  const day = describeDay(t, locale);
  if (t.freq === "monthly") {
    const base =
      t.interval === 1
        ? m.trigger_cal_monthly_1({ day }, { locale })
        : m.trigger_cal_monthly_n({ n: t.interval, day }, { locale });
    return t.byMonth
      ? m.trigger_cal_only_months(
          { base, months: months(t.byMonth, locale) },
          { locale },
        )
      : base;
  }
  const yearMonths = months(
    t.byMonth ?? [parseDate(t.startDate).month],
    locale,
  );
  return t.interval === 1
    ? m.trigger_cal_yearly_1({ day, months: yearMonths }, { locale })
    : m.trigger_cal_yearly_n(
        { n: t.interval, day, months: yearMonths },
        { locale },
      );
}

/**
 * A trigger in plain language, e.g. "Every 3 months from the last completion"
 * or "Every Saturday". Pure: no clock, no network.
 */
export function describeTrigger(trigger: Trigger, locale: UserLocale): string {
  switch (trigger.type) {
    case "interval":
      return describeInterval(trigger, locale);
    case "calendar":
      return describeCalendar(trigger, locale);
    case "min_per_period":
      return m.trigger_min_per_period(
        {
          count: trigger.count,
          period: PERIODS[trigger.period](locale),
        },
        { locale },
      );
    case "counter_delta": {
      const threshold = formatNumber(trigger.threshold, locale);
      const odometer = isOdometerKey(trigger.entityId);
      const base = !trigger.unit
        ? odometer
          ? m.trigger_counter_odometer_plain({ threshold }, { locale })
          : m.trigger_counter({ threshold }, { locale })
        : odometer
          ? m.trigger_counter_odometer(
              { threshold, unit: trigger.unit },
              { locale },
            )
          : m.trigger_counter_unit(
              { threshold, unit: trigger.unit },
              { locale },
            );
      return trigger.orEvery
        ? m.trigger_counter_or_every(
            {
              base,
              every: lowerFirst(
                EVERY[trigger.orEvery.unit](trigger.orEvery.every, locale),
              ),
            },
            { locale },
          )
        : base;
    }
    case "state_condition": {
      const base = m.trigger_state(
        {
          entity: trigger.entityId,
          op: OPS[trigger.op](locale),
          value: String(trigger.value),
        },
        { locale },
      );
      return trigger.forMinutes
        ? m.trigger_state_for({ base, minutes: trigger.forMinutes }, { locale })
        : base;
    }
    case "ha_calendar": {
      const days = Math.abs(trigger.offsetDays);
      const base =
        trigger.offsetDays === 0
          ? m.trigger_ha_calendar_same({}, { locale })
          : trigger.offsetDays < 0
            ? m.trigger_ha_calendar_before({ days }, { locale })
            : m.trigger_ha_calendar_after({ days }, { locale });
      return trigger.summaryMatch
        ? m.trigger_ha_calendar_match(
            { base, match: trigger.summaryMatch },
            { locale },
          )
        : base;
    }
    case "one_off":
      return m.trigger_one_off(
        { date: formatDate(trigger.date, locale) },
        { locale },
      );
    case "kept_bill":
      return m.trigger_bill(
        { date: formatDate(trigger.dueDate, locale) },
        { locale },
      );
    case "warranty":
      return trigger.extendedUntil
        ? m.trigger_warranty_extended(
            {
              until: formatDate(trigger.until, locale),
              extended: formatDate(trigger.extendedUntil, locale),
            },
            { locale },
          )
        : m.trigger_warranty(
            { until: formatDate(trigger.until, locale) },
            { locale },
          );
  }
}
