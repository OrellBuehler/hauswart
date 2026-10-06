import { monthName, weekdayName } from "$lib/format";
import { m } from "$lib/paraglide/messages";

export const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

export function unitOptions() {
  return [
    { value: "day", label: m.unit_day() },
    { value: "week", label: m.unit_week() },
    { value: "month", label: m.unit_month() },
    { value: "year", label: m.unit_year() },
  ];
}

export function weekdayChips() {
  return WEEKDAYS.map((day) => ({
    value: day,
    label: weekdayName(day, "short"),
    aria: weekdayName(day, "long"),
  }));
}

export function monthChips() {
  return MONTHS.map((month) => ({
    value: month,
    label: monthName(month, "short"),
    aria: monthName(month, "long"),
  }));
}
