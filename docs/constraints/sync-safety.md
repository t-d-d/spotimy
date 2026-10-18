# Sync safety
Relevance: What a run may change in a library, when it applies changes, or how it treats removals: service/src/sync/**, service/src/worker.ts
Decision: A run only adds: it saves albums, follows playlists and creates playlists. It never removes anything, and never puts back what a person removed.

Why: spotimy acts on people's libraries while they are not looking. A
bug that adds an album costs a click to undo. One that removes years
of curated playlists cannot be undone.

## Rules

- The only writes to Spotify are saving albums, following playlists,
  creating playlists and adding tracks to a playlist spotimy just made.
- A run reads every member's library, finds what each playlist is, and
  makes a plan for each person. It applies a plan only when that person
  pressed Apply, or turned on automatic apply.
- A new member's first plan always waits for review.
- MEMORY records what a library held after the last run. An album or
  playlist that was there and is now gone was removed by the person,
  and no later run adds it back.
- Follow the group's playlists only for album playlists a member owns,
  and only when the person has no playlist for that album yet.
- One run at a time, for the whole group.
- A plan that could not be fully applied says what failed. The next run
  plans again from what the library now holds.

## Do not

- Delete, unfollow, unsave or reorder anything.
- Re-add an item a person removed, however the plan reasons.
- Apply a plan the person has not seen, unless they turned on
  automatic apply.

History: Set when the repo was made, October 2026.
