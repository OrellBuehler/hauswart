export type Locale = "en" | "de";
export type Localized = Record<Locale, string>;

export interface Slide {
  id: string;
  /** File name of the raw screenshot without `.png` (a line of scripts/screenshots/screens.txt). */
  screen: string;
  /** `brand`: white on the brand colour; `dark` goes with a dark screenshot. */
  theme: "light" | "dark" | "brand";
  /** `*word*` is set in the accent colour. */
  headline: Localized;
  subline: Localized;
}

/** In the order the stores show them; Google Play takes eight at most. German in Swiss spelling. */
export const slides: Slide[] = [
  {
    id: "dashboard",
    screen: "dashboard",
    theme: "brand",
    headline: {
      en: "Your home, *under control*",
      de: "Dein Zuhause *im Griff*",
    },
    subline: {
      en: "What is due today, this week and soon",
      de: "Was heute, diese Woche und bald fällig ist",
    },
  },
  {
    id: "tasks",
    screen: "tasks",
    theme: "light",
    headline: {
      en: "Never forget a *filter* again",
      de: "Nie wieder einen *Filter* vergessen",
    },
    subline: {
      en: "Intervals, calendar rules and seasons",
      de: "Intervalle, Kalenderregeln und Jahreszeiten",
    },
  },
  {
    id: "costs",
    screen: "costs",
    theme: "light",
    headline: {
      en: "Shared costs, *fairly split*",
      de: "Gemeinsame Kosten, *fair geteilt*",
    },
    subline: {
      en: "Cost books, balances and budgets",
      de: "Kostenbücher, Salden und Budgets",
    },
  },
  {
    id: "asset",
    screen: "asset",
    theme: "light",
    headline: {
      en: "Every device *with its history*",
      de: "Jedes Gerät *mit Geschichte*",
    },
    subline: {
      en: "Warranty, upkeep and documents in one place",
      de: "Garantie, Pflege und Dokumente an einem Ort",
    },
  },
  {
    id: "defects",
    screen: "defects",
    theme: "light",
    headline: {
      en: "Defects *tracked* until they are fixed",
      de: "Mängel *verfolgt*, bis sie behoben sind",
    },
    subline: {
      en: "Status, deadlines, comments and photos",
      de: "Status, Fristen, Kommentare und Fotos",
    },
  },
  {
    id: "vehicle",
    screen: "vehicle",
    theme: "light",
    headline: {
      en: "The *car* is covered too",
      de: "Auch das *Auto* ist dabei",
    },
    subline: {
      en: "Odometer, fuel log and tyre sets",
      de: "Kilometerstand, Tankbuch und Reifensätze",
    },
  },
  {
    id: "parts",
    screen: "parts",
    theme: "light",
    headline: {
      en: "Spare parts *in stock*",
      de: "Ersatzteile *an Lager*",
    },
    subline: {
      en: "See what to reorder before it runs out",
      de: "Sehen, was nachbestellt werden muss",
    },
  },
  {
    id: "self-hosted",
    screen: "dashboard-dark",
    theme: "dark",
    headline: {
      en: "*Self-hosted:* your data stays home",
      de: "*Selbst gehostet:* deine Daten bleiben daheim",
    },
    subline: {
      en: "Runs against your own hauswart server",
      de: "Läuft mit deinem eigenen hauswart-Server",
    },
  },
];

/** The feature graphic of Google Play: name, a line of text and two screens. */
export const feature = {
  screens: ["dashboard", "tasks"],
  tagline: {
    en: "Home maintenance for your household, on your own server",
    de: "Wartung für deinen Haushalt, auf deinem eigenen Server",
  } satisfies Localized,
};
