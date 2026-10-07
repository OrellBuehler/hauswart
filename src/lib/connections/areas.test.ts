import { describe, expect, it } from "vitest";
import type { Room } from "$lib/api/schemas/rooms";
import { matchAreaToRoom, roomForArea, roomWithAreaId } from "./areas";

const room = (id: string, name: string, haAreaId: string | null = null) => ({
  id,
  name,
  haAreaId,
});

const areas = [
  { id: "living_room", name: "Wohnzimmer" },
  { id: "kitchen", name: "Küche" },
  { id: "bath", name: "Bad" },
];

describe("roomWithAreaId", () => {
  it("finds the room by its stored id, ignoring case and punctuation", () => {
    const rooms = [room("1", "Stube", "Living-Room"), room("2", "Küche")];
    expect(roomWithAreaId("living_room", rooms)?.id).toBe("1");
    expect(roomWithAreaId("kitchen", rooms)).toBeUndefined();
    expect(roomWithAreaId("", rooms)).toBeUndefined();
  });
});

describe("matchAreaToRoom", () => {
  it("prefers the room that stores the area id, whatever its name", () => {
    const rooms = [room("1", "Wohnzimmer"), room("2", "Stube", "living_room")];
    expect(matchAreaToRoom(areas[0], rooms, areas)).toEqual({
      how: "linked",
      room: rooms[1],
    });
  });

  it("matches an unlinked room by name, with umlauts spelled either way", () => {
    for (const name of ["Küche", "kueche", "KÜCHE", " Küche "]) {
      const rooms = [room("1", name)];
      expect(matchAreaToRoom(areas[1], rooms, areas)?.how, name).toBe("name");
    }
    expect(
      matchAreaToRoom(areas[1], [room("1", "Küchenzeile")], areas),
    ).toBeUndefined();
  });

  it("does not take a room that already stands for another listed area", () => {
    const rooms = [room("1", "Küche", "bath")];
    expect(matchAreaToRoom(areas[1], rooms, areas)).toBeUndefined();
  });

  it("treats a stored id that no listed area has as no link", () => {
    const rooms = [room("1", "Küche", "deleted_area")];
    expect(matchAreaToRoom(areas[1], rooms, areas)).toEqual({
      how: "name",
      room: rooms[0],
    });
  });

  it("matches nothing for a name without letters or digits", () => {
    const odd = { id: "x", name: "---" };
    expect(matchAreaToRoom(odd, [room("1", "***")], [odd])).toBeUndefined();
  });
});

describe("roomForArea", () => {
  const rooms = [
    room("1", "Stube", "living_room"),
    room("2", "Küche"),
    room("3", "Bad", "Kueche_alt"),
  ] as Room[];

  it("matches by area id first, then by the area name", () => {
    expect(roomForArea("Wohnzimmer", rooms, "living_room")?.id).toBe("1");
    expect(roomForArea("Wohnzimmer", rooms)).toBeUndefined();
    expect(roomForArea("Küche", rooms)?.id).toBe("2");
    expect(roomForArea("Kueche", rooms)?.id).toBe("2");
    expect(roomForArea(null, rooms)).toBeUndefined();
  });

  it("keeps matching a stored id against the area name", () => {
    expect(roomForArea("living room", rooms)?.id).toBe("1");
  });
});
