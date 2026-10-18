// A loopback stand-in for Spotify's Web API and accounts service, as a
// development-mode app sees them since February 2026 (test-tiers.md).
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { z } from "zod";
import { parseJson, readBody } from "./read-body.ts";

const h24 = (text: string) =>
  createHash("md5").update(text).digest("hex").slice(0, 24);

export const coverUrl = (albumId: string) =>
  `https://i.scdn.co/image/ab67616d0000b273${h24(albumId)}`;

export interface FakeAlbum {
  id: string;
  name: string;
  artists: string[];
  tracks: number;
  // A different cover from the album's own, as a playlist owner may upload.
  cover?: string;
}

interface FakePlaylist {
  id: string;
  name: string;
  ownerId: string;
  public: boolean;
  snapshot: number;
  entries: { albumId: string; index: number; addedAt: string }[];
  localFiles: number;
  images?: { url: string }[];
}

interface FakeUser {
  id: string;
  name: string;
  allowed: boolean;
  // Playlist ids in library order, newest first: owned and followed.
  library: string[];
  saved: { albumId: string; addedAt: string }[];
}

export interface Call {
  method: string;
  path: string;
  userId: string | undefined;
}

export interface FakeSpotify {
  apiBase: string;
  accountsBase: string;
  calls: Call[];
  addAlbum: (album: FakeAlbum) => void;
  addUser: (id: string, name: string, options?: { allowed?: boolean }) => void;
  // A playlist owned by `ownerId`, put in their library.
  addPlaylist: (
    ownerId: string,
    playlist: {
      id: string;
      name: string;
      tracks: { albumId: string; index: number }[];
      public?: boolean;
      images?: { url: string }[];
      localFiles?: number;
    },
  ) => void;
  follow: (userId: string, playlistId: string) => void;
  unfollow: (userId: string, playlistId: string) => void;
  save: (userId: string, albumId: string, addedAt: string) => void;
  unsave: (userId: string, albumId: string) => void;
  library: (userId: string) => { playlists: string[]; saved: string[] };
  playlist: (
    id: string,
  ) =>
    | { name: string; ownerId: string; public: boolean; tracks: string[] }
    | undefined;
  // Tokens for a user, as if they had signed in.
  tokensFor: (userId: string) => { accessToken: string; refreshToken: string };
  // The browser's part of sign-in: the code Spotify would send back.
  authorize: (userId: string, challenge: string, redirectUri: string) => string;
  // The next `times` API calls get a 429 with this Retry-After.
  limitNext: (times: number, retryAfter: number) => void;
  // Answers calls that match with this status, as Spotify might in a bad hour.
  failMatching: (
    match: (method: string, path: string) => boolean,
    status: number,
  ) => void;
  // As limitNext, but only for calls that match, such as "POST /me/playlists".
  limitMatching: (
    match: (method: string, path: string) => boolean,
    times: number,
    retryAfter: number,
  ) => void;
  expireAccessTokens: () => void;
  reset: () => void;
  close: () => Promise<void>;
}

const pageSize = {
  playlists: 2,
  items: 3,
  albums: 2,
  albumTracks: 50,
  search: 10,
};

export async function startFakeSpotify(): Promise<FakeSpotify> {
  let albums = new Map<string, FakeAlbum>();
  let playlists = new Map<string, FakePlaylist>();
  let users = new Map<string, FakeUser>();
  let access = new Map<string, string>();
  let refresh = new Map<string, string>();
  let codes = new Map<
    string,
    { userId: string; challenge: string; redirectUri: string }
  >();
  type Matcher = (method: string, path: string) => boolean;
  const always: Matcher = () => true;
  let limited = { times: 0, retryAfter: 0, match: always };
  let failing: { match: Matcher; status: number } | undefined;
  const calls: Call[] = [];
  let base = "";

  const token = () => randomBytes(12).toString("hex");
  const issue = (userId: string) => {
    const accessToken = token();
    const refreshToken = token();
    access.set(accessToken, userId);
    refresh.set(refreshToken, userId);
    return { accessToken, refreshToken };
  };

  const albumOf = (id: string) => {
    const album = albums.get(id);
    if (album === undefined) throw new Error(`The fake has no album ${id}.`);
    return album;
  };
  const trackId = (albumId: string, index: number) =>
    `${albumId}t${String(index)}`;
  const simpleAlbum = (album: FakeAlbum) => ({
    id: album.id,
    uri: `spotify:album:${album.id}`,
    name: album.name,
    artists: album.artists.map((name) => ({ name })),
    total_tracks: album.tracks,
    images: [{ url: album.cover ?? coverUrl(album.id) }],
  });
  const track = (albumId: string, index: number) => ({
    id: trackId(albumId, index),
    uri: `spotify:track:${trackId(albumId, index)}`,
    type: "track",
    is_local: false,
    album: simpleAlbum(albumOf(albumId)),
  });
  // Spotify draws one album's cover for a playlist of up to three albums,
  // and a mosaic for four or more.
  const imagesOf = (playlist: FakePlaylist) => {
    if (playlist.images !== undefined) return playlist.images;
    const ids = [...new Set(playlist.entries.map((entry) => entry.albumId))];
    if (ids.length === 0) return null;
    if (ids.length >= 4)
      return [{ url: `https://mosaic.scdn.co/640/${h24(playlist.id)}` }];
    const first = albumOf(ids[0] ?? "");
    return [{ url: first.cover ?? coverUrl(first.id) }];
  };
  const summary = (playlist: FakePlaylist) => ({
    id: playlist.id,
    name: playlist.name,
    snapshot_id: `snap${String(playlist.snapshot)}`,
    owner: { id: playlist.ownerId },
    public: playlist.public,
    images: imagesOf(playlist),
    items: { total: playlist.entries.length },
  });
  const page = <T>(items: T[], offset: number, size: number, path: string) => ({
    items: items.slice(offset, offset + size),
    next:
      offset + size < items.length
        ? `${base}/v1${path}${path.includes("?") ? "&" : "?"}offset=${String(offset + size)}`
        : null,
    total: items.length,
  });
  const albumTracks = (album: FakeAlbum) =>
    Array.from({ length: album.tracks }, (_, index) => ({
      id: trackId(album.id, index + 1),
      uri: `spotify:track:${trackId(album.id, index + 1)}`,
      type: "track",
      is_local: false,
    }));

  const reply = (
    response: ServerResponse,
    status: number,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    response.writeHead(status, {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    });
    response.end(body === undefined ? undefined : JSON.stringify(body));
  };

  const norm = (text: string) =>
    text
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();

  async function accounts(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ) {
    if (request.method !== "POST" || url.pathname !== "/api/token") {
      reply(response, 404);
      return;
    }
    const form = new URLSearchParams(await readBody(request));
    if (form.get("grant_type") === "authorization_code") {
      const code = codes.get(form.get("code") ?? "");
      const verifier = form.get("code_verifier") ?? "";
      const challenge = createHash("sha256")
        .update(verifier)
        .digest("base64url");
      if (
        code === undefined ||
        code.challenge !== challenge ||
        code.redirectUri !== form.get("redirect_uri")
      ) {
        reply(response, 400, { error: "invalid_grant" });
        return;
      }
      codes.delete(form.get("code") ?? "");
      const issued = issue(code.userId);
      reply(response, 200, {
        access_token: issued.accessToken,
        refresh_token: issued.refreshToken,
        expires_in: 3600,
        token_type: "Bearer",
      });
      return;
    }
    if (form.get("grant_type") === "refresh_token") {
      const userId = refresh.get(form.get("refresh_token") ?? "");
      if (userId === undefined) {
        reply(response, 400, { error: "invalid_grant" });
        return;
      }
      const accessToken = token();
      access.set(accessToken, userId);
      reply(response, 200, {
        access_token: accessToken,
        expires_in: 3600,
        token_type: "Bearer",
      });
      return;
    }
    reply(response, 400, { error: "unsupported_grant_type" });
  }

  async function api(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ) {
    const path = url.pathname.replace(/^\/v1/u, "");
    const userId = access.get(
      (request.headers.authorization ?? "").replace(/^Bearer /u, ""),
    );
    calls.push({
      method: request.method ?? "",
      path: `${path}${url.search}`,
      userId,
    });
    if (failing?.match(request.method ?? "", path) === true) {
      reply(response, failing.status, { error: { status: failing.status } });
      return;
    }
    if (limited.times > 0 && limited.match(request.method ?? "", path)) {
      limited.times -= 1;
      reply(
        response,
        429,
        { error: { status: 429 } },
        { "retry-after": String(limited.retryAfter) },
      );
      return;
    }
    if (userId === undefined) {
      reply(response, 401, {
        error: { status: 401, message: "The access token expired" },
      });
      return;
    }
    const user = users.get(userId);
    if (user === undefined || !user.allowed) {
      reply(response, 403, { error: { status: 403 } });
      return;
    }
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const method = request.method ?? "GET";
    let match: RegExpExecArray | null;

    if (method === "GET" && path === "/me") {
      reply(response, 200, { id: user.id, display_name: user.name });
      return;
    }
    if (method === "GET" && path === "/me/playlists") {
      const listed = user.library.flatMap((id) => {
        const playlist = playlists.get(id);
        return playlist === undefined ? [] : [summary(playlist)];
      });
      reply(
        response,
        200,
        page(listed, offset, pageSize.playlists, "/me/playlists?limit=50"),
      );
      return;
    }
    if (
      method === "GET" &&
      (match = /^\/playlists\/(\w+)\/items$/u.exec(path)) !== null
    ) {
      const playlist = playlists.get(match[1] ?? "");
      if (playlist === undefined) {
        reply(response, 404);
        return;
      }
      if (playlist.ownerId !== user.id) {
        reply(response, 403, { error: { status: 403 } });
        return;
      }
      // A local file's track carries an album with no id, as Spotify's does.
      const local = Array.from({ length: playlist.localFiles }, (_, index) => ({
        added_at: "2020-01-01T00:00:00Z",
        is_local: true,
        item: {
          id: null,
          uri: `spotify:local:Someone:Something:Track+${String(index)}:200`,
          type: "track",
          is_local: true,
          album: {
            id: null,
            uri: null,
            name: "Something",
            artists: [],
            images: [],
            total_tracks: 0,
          },
        },
      }));
      const entries = [
        ...local,
        ...playlist.entries.map((entry) => ({
          added_at: entry.addedAt,
          is_local: false,
          item: track(entry.albumId, entry.index),
        })),
      ];
      reply(
        response,
        200,
        page(
          entries,
          offset,
          pageSize.items,
          `/playlists/${playlist.id}/items`,
        ),
      );
      return;
    }
    if (method === "GET" && path === "/me/albums") {
      const entries = user.saved.map((entry) => {
        const album = albumOf(entry.albumId);
        return {
          added_at: entry.addedAt,
          album: {
            ...simpleAlbum(album),
            tracks: page(
              albumTracks(album),
              0,
              pageSize.albumTracks,
              `/albums/${album.id}/tracks`,
            ),
          },
        };
      });
      reply(
        response,
        200,
        page(entries, offset, pageSize.albums, "/me/albums?limit=50"),
      );
      return;
    }
    if (
      method === "GET" &&
      (match = /^\/albums\/(\w+)\/tracks$/u.exec(path)) !== null
    ) {
      const album = albumOf(match[1] ?? "");
      reply(
        response,
        200,
        page(
          albumTracks(album),
          offset,
          pageSize.albumTracks,
          `/albums/${album.id}/tracks`,
        ),
      );
      return;
    }
    if (method === "GET" && path === "/search") {
      const query = url.searchParams.get("q") ?? "";
      const albumField = /album:"([^"]*)"/u.exec(query)?.[1];
      const artistField = /artist:"([^"]*)"/u.exec(query)?.[1];
      const hits = [...albums.values()].filter((album) => {
        const artists = norm(album.artists.join(" "));
        if (albumField !== undefined || artistField !== undefined) {
          return (
            (albumField === undefined ||
              norm(album.name).includes(norm(albumField))) &&
            (artistField === undefined || artists.includes(norm(artistField)))
          );
        }
        return norm(query)
          .split(" ")
          .every((word) => `${artists} ${norm(album.name)}`.includes(word));
      });
      reply(response, 200, {
        albums: page(hits.map(simpleAlbum), 0, pageSize.search, "/search"),
      });
      return;
    }
    if (method === "PUT" && path === "/me/library") {
      const uris = (url.searchParams.get("uris") ?? "")
        .split(",")
        .filter((uri) => uri !== "");
      if (uris.length === 0 || uris.length > 40) {
        reply(response, 400, { error: { status: 400 } });
        return;
      }
      for (const uri of uris) {
        const [, kind, id = ""] = uri.split(":");
        if (
          kind === "album" &&
          albums.has(id) &&
          !user.saved.some((entry) => entry.albumId === id)
        ) {
          user.saved.unshift({
            albumId: id,
            addedAt: new Date().toISOString(),
          });
        }
        if (
          kind === "playlist" &&
          playlists.has(id) &&
          !user.library.includes(id)
        ) {
          user.library.unshift(id);
        }
      }
      reply(response, 200);
      return;
    }
    if (method === "POST" && path === "/me/playlists") {
      const body = z
        .object({ name: z.string(), public: z.boolean().optional() })
        .parse(parseJson(await readBody(request)));
      const id = `New${String(playlists.size + 1)}x${token().slice(0, 6)}`;
      playlists.set(id, {
        id,
        name: body.name,
        ownerId: user.id,
        public: body.public ?? true,
        snapshot: 1,
        entries: [],
        localFiles: 0,
      });
      user.library.unshift(id);
      reply(response, 201, { id, snapshot_id: "snap1", name: body.name });
      return;
    }
    if (
      method === "POST" &&
      (match = /^\/playlists\/(\w+)\/items$/u.exec(path)) !== null
    ) {
      const playlist = playlists.get(match[1] ?? "");
      if (playlist === undefined || playlist.ownerId !== user.id) {
        reply(response, 403, { error: { status: 403 } });
        return;
      }
      const body = z
        .object({ uris: z.array(z.string()) })
        .parse(parseJson(await readBody(request)));
      if (body.uris.length > 100) {
        reply(response, 400, { error: { status: 400 } });
        return;
      }
      for (const uri of body.uris) {
        const found = /^spotify:track:(\w+?)t(\d+)$/u.exec(uri);
        if (found === null) continue;
        playlist.entries.push({
          albumId: found[1] ?? "",
          index: Number(found[2]),
          addedAt: new Date().toISOString(),
        });
      }
      playlist.snapshot += 1;
      reply(response, 201, { snapshot_id: `snap${String(playlist.snapshot)}` });
      return;
    }
    // Includes the old /playlists/{id}/tracks, gone for new apps.
    reply(response, 404, { error: { status: 404 } });
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", base);
    const handle = url.pathname.startsWith("/v1/") ? api : accounts;
    handle(request, response, url).catch(() => {
      reply(response, 500);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("No port.");
  base = `http://127.0.0.1:${String(address.port)}`;

  const userOf = (id: string) => {
    const user = users.get(id);
    if (user === undefined) throw new Error(`The fake has no user ${id}.`);
    return user;
  };

  return {
    apiBase: `${base}/v1`,
    accountsBase: base,
    calls,
    addAlbum: (album) => {
      albums.set(album.id, album);
    },
    addUser: (id, name, options = {}) => {
      users.set(id, {
        id,
        name,
        allowed: options.allowed ?? true,
        library: [],
        saved: [],
      });
    },
    addPlaylist: (ownerId, playlist) => {
      playlists.set(playlist.id, {
        id: playlist.id,
        name: playlist.name,
        ownerId,
        public: playlist.public ?? true,
        snapshot: 1,
        entries: playlist.tracks.map((entry, index) => ({
          ...entry,
          addedAt: `2020-01-${String(10 + (index % 18))}T00:00:00Z`,
        })),
        localFiles: playlist.localFiles ?? 0,
        ...(playlist.images === undefined ? {} : { images: playlist.images }),
      });
      userOf(ownerId).library.push(playlist.id);
    },
    follow: (userId, playlistId) => {
      userOf(userId).library.push(playlistId);
    },
    unfollow: (userId, playlistId) => {
      const user = userOf(userId);
      user.library = user.library.filter((id) => id !== playlistId);
    },
    save: (userId, albumId, addedAt) => {
      userOf(userId).saved.push({ albumId, addedAt });
    },
    unsave: (userId, albumId) => {
      const user = userOf(userId);
      user.saved = user.saved.filter((entry) => entry.albumId !== albumId);
    },
    library: (userId) => {
      const user = userOf(userId);
      return {
        playlists: [...user.library],
        saved: user.saved.map((entry) => entry.albumId),
      };
    },
    playlist: (id) => {
      const playlist = playlists.get(id);
      return playlist === undefined
        ? undefined
        : {
            name: playlist.name,
            ownerId: playlist.ownerId,
            public: playlist.public,
            tracks: playlist.entries.map((entry) =>
              trackId(entry.albumId, entry.index),
            ),
          };
    },
    tokensFor: issue,
    authorize: (userId, challenge, redirectUri) => {
      const code = token();
      codes.set(code, { userId, challenge, redirectUri });
      return code;
    },
    limitNext: (times, retryAfter) => {
      limited = { times, retryAfter, match: always };
    },
    failMatching: (match, status) => {
      failing = { match, status };
    },
    limitMatching: (match, times, retryAfter) => {
      limited = { times, retryAfter, match };
    },
    expireAccessTokens: () => {
      access = new Map();
    },
    reset: () => {
      albums = new Map();
      playlists = new Map();
      users = new Map();
      access = new Map();
      refresh = new Map();
      codes = new Map();
      limited = { times: 0, retryAfter: 0, match: always };
      failing = undefined;
      calls.length = 0;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
