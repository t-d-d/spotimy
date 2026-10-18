// lint-rules/index.js imports this module through Node, which strips types
// but loads any other import and cannot find a path without its extension.
// So this module imports types only, and holds no enum or namespace.
import type { UserId } from "../ids";

export interface Key {
  pk: string;
  sk: string;
}

// A name that ends in # is a prefix. spotimy/no-hand-built-key refuses each
// of these anywhere but here.
export const partitionKeys = {
  group: "GROUP",
  user: "USER#",
} as const;

export const sortKeys = {
  member: "MEMBER#",
  playlist: "PLAYLIST#",
  run: "RUN",
  profile: "PROFILE",
  token: "TOKEN",
  plan: "PLAN",
  memory: "MEMORY",
} as const;

const user = (id: UserId) => `${partitionKeys.user}${id}`;

export const keys = {
  member: (id: UserId): Key => ({
    pk: partitionKeys.group,
    sk: `${sortKeys.member}${id}`,
  }),
  members: () => ({ pk: partitionKeys.group, prefix: sortKeys.member }),
  playlist: (playlistId: string): Key => ({
    pk: partitionKeys.group,
    sk: `${sortKeys.playlist}${playlistId}`,
  }),
  playlists: () => ({ pk: partitionKeys.group, prefix: sortKeys.playlist }),
  run: (): Key => ({ pk: partitionKeys.group, sk: sortKeys.run }),
  profile: (id: UserId): Key => ({ pk: user(id), sk: sortKeys.profile }),
  token: (id: UserId): Key => ({ pk: user(id), sk: sortKeys.token }),
  plan: (id: UserId): Key => ({ pk: user(id), sk: sortKeys.plan }),
  memory: (id: UserId): Key => ({ pk: user(id), sk: sortKeys.memory }),
  userItems: (id: UserId) => ({ pk: user(id) }),
};
