import { asc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { currencyExponent, minor, toDecimalString } from "$lib/money";
import { assets, costEntries, defects, rooms, users } from "$lib/server/db";
import type { ServiceContext } from "$lib/server/service";
import { yearRange } from "./costs";

export const CSV_BOM = "﻿";
export const CSV_SEPARATOR = ";";
export const CSV_EOL = "\r\n";

export const CSV_COLUMNS = [
  "date",
  "title",
  "amount",
  "currency",
  "category",
  "payee",
  "paid_by",
  "split",
  "counts_as_expense",
  "deductible",
  "asset",
  "room",
  "defect",
  "notes",
  "source",
  "id",
] as const;

/**
 * One CSV cell. Text that a spreadsheet would read as a formula (it starts
 * with `=`, `+`, `-`, `@`, a tab or a carriage return) gets an apostrophe in
 * front, so a payee or title that came from outside can never run anything.
 * Fields with the separator, quotes or line breaks are quoted.
 */
export function csvField(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A plain decimal with a point and no thousands separator: `-12.50`, `1949.75`, `100` for yen. */
export function csvAmount(amountMinor: number, currency: string): string {
  return toDecimalString(minor(amountMinor), currencyExponent(currency));
}

const payer = alias(users, "payer");

/** The entries of a year, oldest first, as a CSV text with byte order mark, semicolons and CRLF. */
export function costsCsv(
  ctx: Pick<ServiceContext, "db">,
  year: number,
): string {
  const { from, to } = yearRange(year);
  const rows = ctx.db
    .select({
      cost: costEntries,
      assetName: assets.name,
      roomName: rooms.name,
      defectNumber: defects.number,
      defectTitle: defects.title,
      paidByName: sql<
        string | null
      >`coalesce(${payer.displayName}, ${payer.username})`,
    })
    .from(costEntries)
    .leftJoin(assets, eq(assets.id, costEntries.assetId))
    .leftJoin(rooms, eq(rooms.id, costEntries.roomId))
    .leftJoin(defects, eq(defects.id, costEntries.defectId))
    .leftJoin(payer, eq(payer.id, costEntries.paidByUserId))
    .where(sql`${costEntries.date} >= ${from} and ${costEntries.date} <= ${to}`)
    .orderBy(
      asc(costEntries.date),
      asc(costEntries.createdAt),
      asc(sql`${costEntries}.rowid`),
    )
    .all();
  const lines = [CSV_COLUMNS.join(CSV_SEPARATOR)];
  for (const r of rows) {
    const c = r.cost;
    lines.push(
      [
        c.date,
        csvField(c.title),
        csvAmount(c.amountMinor, c.currency),
        c.currency,
        c.category,
        csvField(c.payee),
        csvField(r.paidByName),
        c.splitMode,
        c.countsAsExpense ? "true" : "false",
        c.deductible,
        csvField(r.assetName),
        csvField(r.roomName),
        csvField(
          r.defectNumber === null
            ? null
            : `#${r.defectNumber} ${r.defectTitle}`,
        ),
        csvField(c.notes),
        c.source,
        c.id,
      ].join(CSV_SEPARATOR),
    );
  }
  return CSV_BOM + lines.join(CSV_EOL) + CSV_EOL;
}
