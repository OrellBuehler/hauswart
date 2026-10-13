/**
 * The key two names of tags or cost books are compared by: composed (NFC) and lower case by German rules, so "Übernachtung",
 * "übernachtung" and a name typed with a combining diaeresis are one name. SQLite's own `lower()` folds ASCII only, so
 * the unique indexes catch the plain cases and this catches the rest, on the server and in the forms alike.
 */
export function nameKey(name: string): string {
  return name.trim().normalize("NFC").toLocaleLowerCase("de");
}
