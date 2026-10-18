// Names and covers, the clues the sync has for a playlist it cannot read.
import type { z } from "zod";
import type { imageSchema } from "../spotify/schemas";

type Image = z.infer<typeof imageSchema>;

interface Named {
  name: string;
  artists: { name: string }[];
}

export const artistNames = (album: Named): string =>
  album.artists.map((artist) => artist.name).join(", ");

// "Artist – Album", the form both members' playlists use.
export const label = (album: Named): string =>
  `${artistNames(album)} – ${album.name}`;

export const playlistName = (album: Named, albumFirst: boolean): string =>
  albumFirst ? `${album.name} – ${artistNames(album)}` : label(album);

// A loose key, so "Artist – Album", "artist - album" and "Artíst — Album"
// compare equal.
export const norm = (text: string): string =>
  text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

// "Artist – Album" or "Album – Artist", split on the first spaced dash.
export function splitName(name: string): [string, string] | undefined {
  const match = /^(.+?)\s+[–—-]\s+(.+)$/u.exec(name);
  const [, first, second] = match ?? [];
  if (first === undefined || second === undefined) return undefined;
  return [first.trim(), second.trim()];
}

// Every loose key a playlist's name could stand for, in either order.
export function nameKeys(name: string): string[] {
  const parts = splitName(name);
  return parts === undefined
    ? [norm(name)]
    : [norm(name), norm(`${parts[1]} ${parts[0]}`)];
}

// An album cover's address is i.scdn.co/image/ab67616d, eight characters
// for its size, then a hash that every size shares.
export function coverHash(images: Image[]): string | undefined {
  for (const image of images) {
    const match =
      /i\.scdn\.co\/image\/ab67616d[0-9a-f]{8}([0-9a-f]{20,})/u.exec(image.url);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
}

// Spotify draws a playlist of four or more albums as a mosaic.
export const isMosaic = (images: Image[]): boolean =>
  images.some((image) => image.url.includes("mosaic.scdn.co"));
