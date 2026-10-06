import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import { createContactRequestSchema } from "$lib/api/schemas/contacts";
import { createHintRequestSchema } from "$lib/api/schemas/hints";
import { createPageRequestSchema } from "$lib/api/schemas/docs";
import { createAsset } from "$lib/server/assets/assets";
import { createAttachment } from "$lib/server/attachments/attachments";
import { createContact } from "$lib/server/contacts/contacts";
import { createPage, updatePage } from "$lib/server/docs/pages";
import { plainPng } from "$lib/server/files/test-images";
import { updateHousehold } from "$lib/server/household/household";
import { createHint } from "$lib/server/hints/hints";
import { createRoom } from "$lib/server/rooms/rooms";
import type { ServiceContext } from "$lib/server/service";
import { samplePdf } from "./files";

export const SECRET_TEXT = "geheimcode-4711";

/**
 * A household with content on both sides of every sharing flag, for the emergency page and the
 * guest link: what must show up carries `visible`/`shared` in its name, what must never leave
 * the house carries `hidden`/`private`.
 */
export async function shareFixture(ctx: ServiceContext, userId: string) {
  updateHousehold(ctx, { name: "Haus Muster" });
  const room = createRoom(ctx, { name: "Keller" });

  const contact = (input: Record<string, unknown>) =>
    createContact(
      ctx,
      createContactRequestSchema.parse({ kind: "other", ...input }),
    );
  const contacts = {
    sharedEmergency: contact({
      name: "Notfall Sanitär",
      company: "Muster AG",
      phone: "044 000 00 01",
      email: "sanitaer@example.org",
      notes: "NOTIZ-KONTAKT",
      address: "Strasse 1",
      emergency: true,
      guestVisible: true,
    }),
    privateEmergency: contact({
      name: "Privat Notfall",
      phone: "044 000 00 02",
      emergency: true,
      guestVisible: false,
    }),
    sharedNeighbour: contact({
      name: "Nachbarin",
      phone: "044 000 00 03",
      guestVisible: true,
    }),
    hidden: contact({ name: "Versteckt", phone: "044 000 00 04" }),
  };

  const page = async (
    input: Record<string, unknown>,
  ): Promise<{ id: string; slug: string }> => {
    const created = await createPage(
      ctx,
      createPageRequestSchema.parse({ bodyMd: "Text", ...input }),
      userId,
    );
    return { id: created.id, slug: created.slug };
  };
  const pages = {
    emergency: await page({
      title: "Wasser abstellen",
      section: "emergency",
      guestVisible: true,
      bodyMd: `Hahn im Keller.\n\n:::secret\nSchlüssel ${SECRET_TEXT}\n:::\n\nEnde.`,
    }),
    rules: await page({
      title: "Hausregeln",
      section: "rules",
      guestVisible: true,
      bodyMd: "Schuhe aus.",
    }),
    howto: await page({
      title: "Kaffeemaschine",
      section: "howto",
      guestVisible: true,
      bodyMd: "Knopf drücken. Siehe [[hausregeln]] und [[geheim-seite]].",
    }),
    general: await page({
      title: "Allgemeines",
      section: "general",
      guestVisible: true,
      bodyMd: "Allgemein.",
    }),
    hiddenRules: await page({
      title: "Interne Regeln",
      section: "rules",
      guestVisible: false,
      bodyMd: "Nur für uns.",
    }),
    hiddenGeneral: await page({
      title: "Geheim Seite",
      section: "general",
      guestVisible: false,
      bodyMd: "Privat.",
    }),
  };

  const attachment = (
    owner: { ownerType: "page" | "asset_hint" | "contact"; ownerId: string },
    guestVisible: boolean,
    pdf = false,
  ) =>
    createAttachment(ctx, {
      bytes: pdf ? new Uint8Array(samplePdf()) : new Uint8Array(plainPng()),
      filename: pdf ? "anleitung.pdf" : "bild.png",
      guestVisible,
      uploadedBy: userId,
      ...owner,
    });
  const files = {
    pageShared: await attachment(
      { ownerType: "page", ownerId: pages.howto.id },
      true,
    ),
    pagePrivate: await attachment(
      { ownerType: "page", ownerId: pages.howto.id },
      false,
    ),
    onHiddenPage: await attachment(
      { ownerType: "page", ownerId: pages.hiddenGeneral.id },
      true,
    ),
    onRulesPage: await attachment(
      { ownerType: "page", ownerId: pages.rules.id },
      true,
    ),
    onContact: await attachment(
      { ownerType: "contact", ownerId: contacts.sharedEmergency.id },
      true,
    ),
  };
  await updatePage(
    ctx,
    pages.howto.slug,
    {
      rev: 1,
      bodyMd: `Knopf drücken. Siehe [[hausregeln]] und [[geheim-seite]].\n\n![zeigt](attachment:${files.pageShared.id}) ![privat](attachment:${files.pagePrivate.id})`,
    },
    userId,
  );

  const asset = (input: Record<string, unknown>) =>
    createAsset(
      ctx,
      createAssetRequestSchema.parse({ kind: "device", ...input }),
    );
  const assets = {
    boiler: asset({
      name: "Boiler",
      roomId: room.id,
      showOnEmergency: true,
      notes: "NOTIZ-GERAET",
      serialNumber: "SERIAL-GERAET",
    }),
    shutoff: asset({ name: "Absperrhahn", showOnEmergency: true }),
    coffee: asset({ name: "Kaffeemaschine", showOnEmergency: false }),
    plain: asset({ name: "Unscheinbar", showOnEmergency: false }),
  };
  const hint = (assetId: string, input: Record<string, unknown>) =>
    createHint(
      ctx,
      assetId,
      createHintRequestSchema.parse({ kind: "tip", ...input }),
    );
  const hints = {
    boilerShared: hint(assets.boiler.id, {
      title: "Sicherung",
      bodyMd: `Im Keller.\n\n:::secret\nCode ${SECRET_TEXT}\n:::`,
      pinned: true,
      guestVisible: true,
    }),
    boilerPrivate: hint(assets.boiler.id, {
      title: "Interner Hinweis",
      bodyMd: "HINT-INTERN",
      pinned: true,
      guestVisible: false,
    }),
    boilerUnpinned: hint(assets.boiler.id, {
      title: "Wartung",
      bodyMd: "Jährlich.",
      pinned: false,
      guestVisible: true,
    }),
    coffeeShared: hint(assets.coffee.id, {
      title: "Entkalken",
      bodyMd: "Monatlich.",
      guestVisible: true,
    }),
    plainPrivate: hint(assets.plain.id, {
      title: "Nur intern",
      bodyMd: "Intern.",
      guestVisible: false,
    }),
  };
  const hintFiles = {
    shared: await attachment(
      { ownerType: "asset_hint", ownerId: hints.boilerShared.id },
      true,
      true,
    ),
    private: await attachment(
      { ownerType: "asset_hint", ownerId: hints.boilerShared.id },
      false,
      true,
    ),
    onPrivateHint: await attachment(
      { ownerType: "asset_hint", ownerId: hints.boilerPrivate.id },
      true,
      true,
    ),
  };

  return { room, contacts, pages, files, assets, hints, hintFiles };
}
