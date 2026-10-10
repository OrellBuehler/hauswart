import { THEME_COLORS } from "./colors";

export interface WebManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: "any" | "maskable";
}

export interface WebManifestShortcut {
  name: string;
  short_name: string;
  url: string;
  icons: WebManifestIcon[];
}

export interface WebManifest {
  id: string;
  name: string;
  short_name: string;
  description: string;
  lang: string;
  start_url: string;
  scope: string;
  display: "standalone";
  background_color: string;
  theme_color: string;
  /** The palette for the dark colour scheme (Chromium; others ignore it). */
  color_scheme_dark: { theme_color: string; background_color: string };
  categories: string[];
  icons: WebManifestIcon[];
  shortcuts: WebManifestShortcut[];
}

/** The names of the shortcuts, in the language of the visitor. */
export interface ShortcutNames {
  newTask: string;
  newDefect: string;
  emergency: string;
  search: string;
}

/** The icons are rendered by `scripts/generate-pwa-icons.ts` into `static/icons`. */
export const MANIFEST_ICONS: WebManifestIcon[] = [
  {
    src: "/icons/icon-192.png",
    sizes: "192x192",
    type: "image/png",
    purpose: "any",
  },
  {
    src: "/icons/icon-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "any",
  },
  {
    src: "/icons/icon-maskable-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "maskable",
  },
];

/** Long-press menu of the home screen icon: the places a person goes to straight away. */
function shortcuts(names: ShortcutNames): WebManifestShortcut[] {
  const icon = MANIFEST_ICONS.find(
    (i) => i.sizes === "192x192" && i.purpose === "any",
  )!;
  return [
    { name: names.newTask, url: "/tasks/new" },
    { name: names.newDefect, url: "/defects/new" },
    { name: names.emergency, url: "/emergency" },
    { name: names.search, url: "/search" },
  ].map(({ name, url }) => ({ name, short_name: name, url, icons: [icon] }));
}

/**
 * The web app manifest. A manifest holds a single colour pair, so it carries the light palette
 * (plus the dark one as `color_scheme_dark` for the platforms that read it); the `theme-color`
 * meta tags of `app.html` follow the chosen colour mode.
 */
export function buildManifest(text: {
  name: string;
  description: string;
  lang: string;
  shortcuts: ShortcutNames;
}): WebManifest {
  return {
    id: "/",
    name: text.name,
    short_name: text.name,
    description: text.description,
    lang: text.lang,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: THEME_COLORS.light,
    theme_color: THEME_COLORS.light,
    color_scheme_dark: {
      theme_color: THEME_COLORS.dark,
      background_color: THEME_COLORS.dark,
    },
    categories: ["lifestyle", "productivity", "utilities"],
    icons: MANIFEST_ICONS,
    shortcuts: shortcuts(text.shortcuts),
  };
}
