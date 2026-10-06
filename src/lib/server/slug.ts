const TRANSLITERATE: Record<string, string> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ø: "o",
  å: "a",
};

const MAX_SLUG = 64;

/** `Küche & Bad` -> `kueche-bad`. Never empty. */
export function slugify(name: string): string {
  const lowered = name
    .toLowerCase()
    .replace(/[äöüßæœøå]/g, (c) => TRANSLITERATE[c] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
  const slug = lowered
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG - 6)
    .replace(/-+$/g, "");
  return slug || "item";
}

/** `base`, then `base-2`, `base-3`, ... until `taken` says it is free. */
export function uniqueSlug(base: string, taken: (slug: string) => boolean) {
  if (!taken(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken(candidate)) return candidate;
  }
}
