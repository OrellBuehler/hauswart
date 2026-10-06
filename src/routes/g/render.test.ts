import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import Home from "./[token]/+page.svelte";
import Doc from "./[token]/docs/[slug]/+page.svelte";

const html = (component: unknown, props: Record<string, unknown>) =>
  render(component as never, { props: props as never }).body;

const home = {
  householdName: "Haus <b>Muster</b>",
  emergencyContacts: [
    {
      id: "c1",
      name: '<img src=x onerror="alert(1)">',
      company: "Muster AG",
      phone: "+41 44 000 00 01",
      email: "a@example.org",
    },
  ],
  contacts: [
    { id: "c2", name: "Nachbarin", company: null, phone: null, email: null },
  ],
  devices: [
    {
      id: "d1",
      name: "Boiler",
      roomName: "Keller",
      hints: [
        {
          id: "h1",
          title: "Sicherung",
          kind: "warning",
          html: "<p>Im <strong>Keller</strong></p>",
          files: [
            {
              id: "f1",
              filename: "plan.pdf",
              caption: null,
              mime: "application/pdf",
            },
          ],
        },
      ],
    },
  ],
  pages: {
    emergency: [{ slug: "wasser", title: "Wasser abstellen" }],
    rules: [],
    howto: [],
    other: [{ slug: "allgemein", title: "Allgemein" }],
  },
};

describe("guest pages as rendered HTML", () => {
  it("renders the start page with escaped names, dialable links and file links", () => {
    const out = html(Home, {
      data: { locked: false, token: "tok", locale: "de", secrets: false, home },
      form: null,
    });
    expect(out).toContain("Haus &lt;b>Muster&lt;/b>");
    expect(out).toContain("&lt;img src=x");
    expect(out).not.toContain("<img src=x");
    expect(out).toContain('href="tel:+41440000001"');
    expect(out).toContain('href="mailto:a@example.org"');
    expect(out).toContain("Notfallkontakte");
    expect(out).toContain("Achtung: Sicherung");
    expect(out).toContain("<strong>Keller</strong>");
    expect(out).toContain("Raum: Keller");
    expect(out).toContain("Wasser abstellen");
    expect(out).toContain("Weitere Seiten");
    expect(out).toMatch(/href="\/g\/tok\/docs\/wasser"/);
    expect(out).toMatch(/href="\/g\/tok\/files\/f1"/);
    expect(out).toContain("plan.pdf");
    expect(out).not.toContain("vertraulich");
  });

  it("speaks English for an English link", () => {
    const out = html(Home, {
      data: { locked: false, token: "tok", locale: "en", secrets: false, home },
      form: null,
    });
    expect(out).toContain("Emergency contacts");
    expect(out).toContain("Warning: Sicherung");
    expect(out).toContain('lang="en"');
  });

  it("warns on a link that includes secrets", () => {
    const out = html(Home, {
      data: { locked: false, token: "tok", locale: "de", secrets: true, home },
      form: null,
    });
    expect(out).toContain("Enthält vertrauliche Angaben");
  });

  it("says so when nothing is shared", () => {
    const out = html(Home, {
      data: {
        locked: false,
        token: "tok",
        locale: "de",
        secrets: false,
        home: {
          householdName: "Haus",
          emergencyContacts: [],
          contacts: [],
          devices: [],
          pages: { emergency: [], rules: [], howto: [], other: [] },
        },
      },
      form: null,
    });
    expect(out).toContain("nichts freigegeben");
  });

  it("asks for the PIN, reveals nothing, and reports a failed attempt", () => {
    const locked = html(Home, {
      data: { locked: true, locale: "de" },
      form: null,
    });
    expect(locked).toContain("PIN eingeben");
    expect(locked).toContain('method="POST"');
    expect(locked).toContain('name="pin"');
    expect(locked).not.toContain("Haus");
    expect(
      html(Home, {
        data: { locked: true, locale: "de" },
        form: { error: "wrong" },
      }),
    ).toContain("Die PIN stimmt nicht.");
    expect(
      html(Home, {
        data: { locked: true, locale: "en" },
        form: { error: "limited" },
      }),
    ).toContain("Too many attempts");
  });

  it("renders a shared page, its sanitized html as given, and a way back", () => {
    const out = html(Doc, {
      data: {
        locked: false,
        token: "tok",
        locale: "de",
        secrets: false,
        page: {
          title: "Kaffee <i>x</i>",
          html: "<p>Knopf <em>drücken</em></p>",
        },
      },
      form: null,
    });
    expect(out).toContain("Kaffee &lt;i>x&lt;/i>");
    expect(out).not.toContain("<i>x</i>");
    expect(out).toContain("<p>Knopf <em>drücken</em></p>");
    expect(out).toMatch(/href="\/g\/tok"/);
    expect(out).toContain("Zur Übersicht");
  });
});
