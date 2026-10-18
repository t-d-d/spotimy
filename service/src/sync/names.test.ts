import { describe, expect, it } from "vitest";
import {
  coverHash,
  isMosaic,
  label,
  nameKeys,
  norm,
  playlistName,
  splitName,
} from "./names";

const bully = { name: "Lucky For You", artists: [{ name: "Bully" }] };

describe("names", () => {
  it("writes an album as Artist – Album, or Album – Artist on request", () => {
    expect(label(bully)).toBe("Bully – Lucky For You");
    expect(playlistName(bully, false)).toBe("Bully – Lucky For You");
    expect(playlistName(bully, true)).toBe("Lucky For You – Bully");
    expect(
      label({ name: "Duet", artists: [{ name: "A" }, { name: "B" }] }),
    ).toBe("A, B – Duet");
  });

  it("compares names loosely: case, accents, dashes and marks", () => {
    expect(norm("Artíst — Album!")).toBe(norm("artist - album"));
    expect(norm("Belle & Sebastian")).toBe("belle sebastian");
  });

  it("splits a name on its first spaced dash", () => {
    expect(splitName("Death Cab for Cutie – I Built You A Tower")).toEqual([
      "Death Cab for Cutie",
      "I Built You A Tower",
    ]);
    expect(splitName("Jay-Z - Album – Deluxe")).toEqual([
      "Jay-Z",
      "Album – Deluxe",
    ]);
    expect(splitName("Road trip")).toBeUndefined();
  });

  it("gives a name's key in both orders", () => {
    expect(nameKeys("Lucky For You – Bully")).toEqual([
      "lucky for you bully",
      "bully lucky for you",
    ]);
    expect(nameKeys("Road trip")).toEqual(["road trip"]);
  });

  it("reads one hash from an album cover at any size", () => {
    const hash = "1356b24d48cbabc44384e753";
    expect(
      coverHash([{ url: `https://i.scdn.co/image/ab67616d0000b273${hash}` }]),
    ).toBe(hash);
    expect(
      coverHash([{ url: `https://i.scdn.co/image/ab67616d00004851${hash}` }]),
    ).toBe(hash);
    expect(
      coverHash([
        { url: "https://misc.spotifycdn.com/static/images/playlist.png" },
      ]),
    ).toBeUndefined();
    expect(coverHash([])).toBeUndefined();
  });

  it("knows a mosaic cover", () => {
    expect(isMosaic([{ url: "https://mosaic.scdn.co/640/abc" }])).toBe(true);
    expect(
      isMosaic([{ url: "https://i.scdn.co/image/ab67616d0000b273aaaa" }]),
    ).toBe(false);
  });
});
