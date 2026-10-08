import { THEME_COLORS } from "./colors";

export interface WebManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: "any" | "maskable";
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
  icons: WebManifestIcon[];
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

/**
 * The web app manifest. A manifest holds a single colour pair, so it carries the light palette;
 * the `theme-color` meta tags of `app.html` follow the dark palette and the chosen colour mode.
 */
export function buildManifest(text: {
  name: string;
  description: string;
  lang: string;
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
    icons: MANIFEST_ICONS,
  };
}
