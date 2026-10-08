/**
 * Colours of the installed app. They mirror the tokens in `app.css` (`--background` in the light and
 * the dark palette, `--brand`); `colors.test.ts` fails when they drift apart.
 */
export const THEME_COLORS = { light: "#fafbfc", dark: "#0e0f13" } as const;

/** Brand colour of the app icons (the light palette's `--brand`). */
export const BRAND_COLOR = "#107f6d";
