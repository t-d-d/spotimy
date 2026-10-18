# Sync safety
Relevance: What a run may change in a library, when it applies changes, or how it treats removals: service/src/sync/**, service/src/worker.ts, service/src/api.ts
Decision: A run only adds, applies only what the person saw or set to run by itself, and never puts back what a person removed.

Why: spotimy acts on people's libraries while they are not looking. A
bug that adds an album costs a click to undo. One that removes years
of curated playlists cannot be undone, and one that adds what someone
took away teaches them not to trust it.

## Rules

- The only writes to Spotify are saving albums, following playlists,
  creating playlists, and adding tracks to a playlist spotimy made.
- A run reads every member's library, finds what each playlist is, and
  makes a plan for each person.
- An apply names the plan the person was shown, by the run that made
  it. If a later run has replaced that plan, the API refuses the press,
  and the worker applies nothing. The worker applies only the actions
  that were in that plan. Anything new waits for the person's next look.
- The schedule applies the whole plan only for someone who turned on
  automatic apply and has pressed Apply at least once themselves.
- MEMORY records what a library held after the last run. An album is
  remembered by its id and by a loose key of artist and title, since
  one album often has several editions. An album gone by both was
  removed, and no later run saves any edition of it, follows a
  playlist of it, or makes one for it. The same holds for a removed
  playlist, and for the album it held.
- Each change goes into MEMORY as soon as Spotify takes it, so a run
  that stops partway still knows what it did.
- A new playlist is recorded before its tracks go in. One whose tracks
  did not all go in is finished by the next apply, adding only what is
  missing.
- Follow the group's playlists only for album playlists a member owns,
  and only when the person has no playlist for that album yet.
- One run at a time, for the whole group. The API takes the lock before
  it starts the worker.
- A run that stops early says so, and its plan lists what is left.

## Do not

- Delete, unfollow, unsave, reorder or replace anything.
- Re-add an item a person removed, however the plan reasons.
- Apply anything the person has not seen, unless they turned on
  automatic apply.
- Match removals by album id alone: another edition would come back.

Judgment: If Spotify accepts a save but does not add the album, for
example because it is not sold in the person's country, the next run
counts it as removed. That errs the safe way.
History: Set when the repo was made, October 2026. Tightened the same day after a review found applies that went beyond the plan shown.
