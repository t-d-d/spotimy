# Table design
Relevance: Any read or write of the table, a new kind of stored item, or the table's definition: service/src/store/**, serverless.yml
Decision: One table. A person's own items sit under USER#<id>, what the group shares under GROUP, with no indexes and no scans.

Why: spotimy serves one small group, and syncing needs what every
member's library holds. Two kinds of partition keep a person's tokens
apart from what the group shares, and every read is along a key.

## Rules

- Partition keys: GROUP, and USER#<id> for each person.
- Under GROUP: MEMBER#<id> for each member, PLAYLIST#<id> for what a
  playlist was found to be, RUN for the one run in progress and how far
  it has got, OUTCOME for how the last run ended, and ALLOWANCE for the
  group's Spotify calls today.
- Under USER#<id>: PROFILE (name and settings), TOKEN (Spotify tokens),
  PLAN (the last run's plan and the person's last apply) and MEMORY
  (what the library held after the last run, what the person removed,
  whether they have applied once, and playlists left to finish).
- TOKEN, PLAN and MEMORY are written only while PROFILE exists, in one
  transaction with a check on it, so nothing comes back after leaving.
- The user id in a key comes from a verified session or from Spotify's
  answer at sign-in, never from a request body.
- One store module is the only code that reads or writes the table.
- One module, inside the store, builds every key.
- Every read is strongly consistent.
- Only one run holds RUN at a time, taken with a conditional write.
- A new kind of item gets its own sort key, added in the key module.
- Leaving deletes PROFILE first, then every item under the person's
  USER# key, their MEMBER# item, and the PLAYLIST# items for playlists
  they own.

## Do not

- Add a secondary index or scan the table.
- Write a key by hand outside the key module.
- Import the database client outside the store module.
- Put a Spotify token anywhere but TOKEN.

History: Set when the repo was made, October 2026. ALLOWANCE added in [#8](https://github.com/t-d-d/spotimy/issues/8).
