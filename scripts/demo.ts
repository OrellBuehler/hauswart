import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { ApiError } from "../src/lib/api/errors.ts";
import { createApiClient } from "../src/lib/api/client.ts";
import { endpoints } from "../src/lib/api/registry.ts";
import { seedSchema } from "../src/lib/api/schemas/seed.ts";
import { addDays, todayIn, zonedTimeToInstant } from "../src/lib/dates.ts";
import { importSeed } from "../src/lib/server/seed/import.ts";

const USAGE = `Usage: bun scripts/demo.ts --url <http://host:3000> [--locale de|en] [--out <file.json>]

Fills an empty server with an invented household: two people, the example seed
(seed/example.<locale>.json), finished tasks, contacts, defects, parts, costs
and an appointment. The server must have no user yet. Prints (and with --out
writes) the sign-in and the addresses of a few entries as JSON; the store
screenshots of the mobile apps are taken from it (mobile/scripts/screenshots).`;

export const DEMO_USERNAME = "demo";
export const DEMO_PASSWORD = "demo-household-only";

type Locale = "de" | "en";

const TEXTS = {
  de: {
    first: "Anna",
    second: "Ben",
    management: "Hausverwaltung",
    managementCompany: "Muster Verwaltung AG",
    plumber: "Sanitär Notdienst",
    plumberCompany: "Muster Sanitär GmbH",
    defectTap: "Wasserhahn tropft",
    defectTapDetail: "Spüle, Kaltwasser",
    defectJoint: "Riss in der Silikonfuge",
    defectJointDetail: "Duschwanne, linke Ecke",
    defectFloor: "Kratzer im Parkett",
    defectFloorDetail: "Vor der Balkontür",
    reported: "Der Verwaltung gemeldet.",
    fixed: "Vom Bodenleger ausgebessert.",
    partFilter: "Aktivkohlefilter DA-60",
    partBags: "Kehrichtsäcke 35 l",
    partDescaler: "Entkalker",
    supplier: "Musterwerk Shop",
    costs: [
      ["Wocheneinkauf", "groceries", 14230, 1],
      ["Strom Oktober", "utilities", 8640, 3],
      ["Aktivkohlefilter", "household", 3490, 5],
      ["Abendessen zu zweit", "dining", 9600, 8],
      ["Wocheneinkauf", "groceries", 12875, 9],
      ["Internet", "subscriptions", 5900, 12],
      ["Reparatur Geschirrspüler", "repair", 21800, 15],
      ["Pflanzenerde und Dünger", "household", 2760, 18],
      ["Hausratversicherung", "insurance", 31200, 24],
    ],
    appointment: "Winterreifen montieren",
    garage: "Garage Muster",
    station: "Tankstelle Muster",
    fuel: "",
    books: {} as Record<string, string>,
  },
  en: {
    first: "Anna",
    second: "Ben",
    management: "Property management",
    managementCompany: "Sample Property Ltd",
    plumber: "Emergency plumber",
    plumberCompany: "Sample Plumbing Ltd",
    defectTap: "Dripping tap",
    defectTapDetail: "Sink, cold water",
    defectJoint: "Crack in the silicone joint",
    defectJointDetail: "Shower tray, left corner",
    defectFloor: "Scratch in the parquet",
    defectFloorDetail: "In front of the balcony door",
    reported: "Reported to the property management.",
    fixed: "Touched up by the floor fitter.",
    partFilter: "Carbon filter DA-60",
    partBags: "Rubbish bags 35 l",
    partDescaler: "Descaler",
    supplier: "Musterwerk shop",
    costs: [
      ["Weekly shop", "groceries", 14230, 1],
      ["Electricity October", "utilities", 8640, 3],
      ["Carbon filter", "household", 3490, 5],
      ["Dinner for two", "dining", 9600, 8],
      ["Weekly shop", "groceries", 12875, 9],
      ["Internet", "subscriptions", 5900, 12],
      ["Dishwasher repair", "repair", 21800, 15],
      ["Potting soil and fertiliser", "household", 2760, 18],
      ["Contents insurance", "insurance", 31200, 24],
    ],
    appointment: "Fit the winter tyres",
    garage: "Sample Garage",
    station: "Sample filling station",
    // The books a new server starts with and the entries it writes for a fill-up have German names.
    fuel: "Fuel",
    books: { Wohnung: "Flat", Haushalt: "Household", Auto: "Car" } as Record<
      string,
      string
    >,
  },
} as const;

/**
 * When the tasks of the seed start, in days from today and by their position in the file, so that
 * the household looks the same whenever the demo is made: one task overdue, some due today and
 * this week, the rest later. Tasks that are not listed keep the date of the file.
 */
const START_IN_DAYS: Record<number, number> = {
  0: -25,
  1: 12,
  2: -40,
  3: -2,
  5: 0,
  6: 0,
  7: 0,
  8: 0,
  9: 0,
};

/** Which of them were done how many days ago. */
const DONE_DAYS_AGO: Record<number, number> = {
  0: 20,
  2: 34,
};

/** The fill-ups of the car: days ago, odometer, litres, price in minor units. */
const FILL_UPS = [
  [30, 41_200, 38.2, 6840],
  [16, 41_830, 41.5, 7430],
  [6, 42_410, 39.7, 7215],
] as const;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    locale: { type: "string", default: "de" },
    out: { type: "string" },
    help: { type: "boolean", default: false },
  },
});
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
if (!values.url) fail(`--url is required\n\n${USAGE}`);
if (values.locale !== "de" && values.locale !== "en")
  fail(`--locale is de or en\n\n${USAGE}`);
const baseUrl = values.url.replace(/\/+$/, "");
const locale: Locale = values.locale;
const t = TEXTS[locale];

let cookie = "";
const sessionFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set("Origin", baseUrl);
  if (cookie) headers.set("Cookie", cookie);
  const response = await fetch(input, { ...init, headers });
  const set = response.headers.getSetCookie().map((c) => c.split(";")[0]);
  if (set.length > 0) cookie = set.join("; ");
  return response;
};

async function run() {
  const session = createApiClient(sessionFetch, baseUrl);
  const status = await session.call(endpoints.setupStatus);
  if (!status.needsSetup)
    fail("The server already has users; the demo needs an empty one.");

  const { user: first } = await session.call(endpoints.setup, {
    body: {
      username: DEMO_USERNAME,
      displayName: t.first,
      password: DEMO_PASSWORD,
      locale,
    },
  });
  const { user: second } = await session.call(endpoints.usersCreate, {
    body: {
      username: "demo2",
      displayName: t.second,
      password: DEMO_PASSWORD,
      locale,
    },
  });
  const { token } = await session.call(endpoints.tokensCreate, {
    body: {
      name: "demo",
      kind: "integration",
      scopes: ["read", "write", "docs:write", "costs:write", "admin"],
    },
  });
  const api = createApiClient(fetch, baseUrl, { token });

  const seedFile = new URL(`../seed/example.${locale}.json`, import.meta.url);
  const seed = seedSchema.parse(JSON.parse(readFileSync(seedFile, "utf8")));
  const household = await api.call(endpoints.householdGet);
  const today = todayIn(household.timezone, Date.now());
  for (const [index, days] of Object.entries(START_IN_DAYS)) {
    const trigger = seed.tasks[Number(index)]?.trigger;
    if (trigger && "startDate" in trigger)
      trigger.startDate = addDays(today, days);
  }
  await importSeed(api, seed);
  const rooms = (await api.call(endpoints.roomsList, { query: { limit: 100 } }))
    .items;
  const assets = (
    await api.call(endpoints.assetsList, { query: { limit: 100 } })
  ).items;
  const tasks = (await api.call(endpoints.tasksList, { query: { limit: 100 } }))
    .items;
  const room = (index: number) => {
    const found = rooms.find((r) => r.slug === seed.rooms[index]?.key);
    if (!found) fail(`Room ${index} of the seed is missing`);
    return found;
  };
  const asset = (index: number) => {
    const found = assets.find((a) => a.slug === seed.assets[index]?.key);
    if (!found) fail(`Asset ${index} of the seed is missing`);
    return found;
  };
  const task = (index: number) => {
    const found = tasks.find((k) => k.externalRef === seed.tasks[index]?.key);
    if (!found) fail(`Task ${index} of the seed is missing`);
    return found;
  };

  for (const [index, daysAgo] of Object.entries(DONE_DAYS_AGO)) {
    await api.call(endpoints.tasksComplete, {
      params: { id: task(Number(index)).id },
      body: {
        completedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
      },
    });
  }

  const management = await api.call(endpoints.contactsCreate, {
    body: {
      kind: "property_mgmt",
      name: t.management,
      company: t.managementCompany,
      phone: "+41 00 000 00 00",
      email: "verwaltung@example.org",
    },
  });
  await api.call(endpoints.contactsCreate, {
    body: {
      kind: "emergency",
      name: t.plumber,
      company: t.plumberCompany,
      phone: "+41 00 000 00 01",
      emergency: true,
    },
  });

  const tap = await api.call(endpoints.defectsCreate, {
    body: {
      title: t.defectTap,
      severity: "medium",
      roomId: room(0).id,
      locationDetail: t.defectTapDetail,
      discoveredOn: addDays(today, -2),
    },
  });
  const joint = await api.call(endpoints.defectsCreate, {
    body: {
      title: t.defectJoint,
      severity: "high",
      roomId: room(1).id,
      locationDetail: t.defectJointDetail,
      discoveredOn: addDays(today, -12),
      responsibleContactId: management.id,
    },
  });
  await api.call(endpoints.defectsStatus, {
    params: { id: joint.id },
    body: {
      status: "reported",
      note: t.reported,
      reportedOn: addDays(today, -10),
    },
  });
  const floor = await api.call(endpoints.defectsCreate, {
    body: {
      title: t.defectFloor,
      severity: "low",
      roomId: room(2).id,
      locationDetail: t.defectFloorDetail,
      discoveredOn: addDays(today, -40),
    },
  });
  await api.call(endpoints.defectsStatus, {
    params: { id: floor.id },
    body: { status: "fixed", note: t.fixed, fixedOn: addDays(today, -21) },
  });

  await api.call(endpoints.partsCreate, {
    body: {
      name: t.partFilter,
      supplier: t.supplier,
      unitPriceMinor: 3490,
      stockCount: 1,
      minStock: 1,
    },
  });
  await api.call(endpoints.partsCreate, {
    body: {
      name: t.partBags,
      unitPriceMinor: 1990,
      stockCount: 4,
      minStock: 5,
      reorderQty: 10,
    },
  });
  await api.call(endpoints.partsCreate, {
    body: { name: t.partDescaler, stockCount: 2, minStock: 1 },
  });

  const books = await api.call(endpoints.costBooksList, {
    query: { limit: 100 },
  });
  for (const book of books.items) {
    const name = t.books[book.name];
    if (name)
      await api.call(endpoints.costBooksUpdate, {
        params: { id: book.id },
        body: { name },
      });
  }

  const payers = [first.id, second.id];
  for (const [daysAgo, odometer, quantity, amountMinor] of FILL_UPS) {
    await api.call(endpoints.fuelLogsCreate, {
      params: { id: asset(6).id },
      body: {
        date: addDays(today, -daysAgo),
        odometer,
        quantity,
        amountMinor,
        station: t.station,
        paidByUserId: first.id,
      },
    });
  }
  if (t.fuel) {
    const fuel = await api.call(endpoints.costsList, {
      query: { category: "fuel", limit: 100 },
    });
    for (const entry of fuel.items)
      await api.call(endpoints.costsUpdate, {
        params: { id: entry.id },
        body: { title: `${t.fuel} ${t.station}` },
      });
  }
  let firstCost: string | undefined;
  for (const [index, entry] of t.costs.entries()) {
    const [title, category, amountMinor, daysAgo] = entry;
    const created = await api.call(endpoints.costsCreate, {
      body: {
        title,
        category,
        amountMinor,
        date: addDays(today, -daysAgo),
        paidByUserId: payers[index % 2],
      },
    });
    firstCost ??= created.id;
  }

  const appointmentDay = addDays(today, 3);
  const startsAt = zonedTimeToInstant(
    appointmentDay,
    "08:00",
    household.timezone,
  );
  await api.call(endpoints.appointmentsCreate, {
    body: {
      title: t.appointment,
      location: t.garage,
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(startsAt + 3_600_000).toISOString(),
      assetId: asset(6).id,
    },
  });

  const result = {
    url: baseUrl,
    locale,
    username: DEMO_USERNAME,
    password: DEMO_PASSWORD,
    // Addresses as the web app has them; the mobile apps open the same ones.
    links: {
      home: "/",
      tasks: "/tasks",
      task: `/tasks/${task(3).id}`,
      costs: "/costs",
      cost: `/costs/${firstCost}`,
      inventory: "/inventory",
      asset: `/assets/${asset(0).id}`,
      vehicle: `/assets/${asset(6).id}`,
      plants: "/plants",
      defects: "/defects",
      defect: `/defects/${tap.id}`,
      parts: "/parts",
      contacts: "/contacts",
      appointments: "/appointments",
    },
  };
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (values.out) writeFileSync(values.out, json);
  console.log(json);
}

try {
  await run();
} catch (err) {
  if (err instanceof ApiError)
    fail(`The server refused a request: ${err.status} ${err.code}`);
  throw err;
}
