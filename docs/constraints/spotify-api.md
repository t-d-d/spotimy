# Spotify Web API
Relevance: Any call to Spotify, its schemas, or how the sync reads a library: service/src/spotify/**, service/src/sync/**
Decision: Only Spotify's documented Web API, as a development-mode app allows it, paced, with every answer parsed and every limit respected.

Why: The app runs in Spotify's development mode, which caps users at
five, limits the endpoints, and shares one rate limit across all of
the owner's apps. The playlist folders people use are not in the API.

## Rules

- Call only documented endpoints, under their February 2026 names:
  /me/library to save and follow, /playlists/{id}/items for a
  playlist's tracks, /me/playlists to create one.
- A playlist's tracks can be read only by its owner or a collaborator.
  A member's playlists are read with that member's own token.
- A playlist owned by someone outside the group is identified from its
  name and confirmed by its cover art, the album's own image when the
  playlist holds one album. A match by name alone is marked as such.
- Every call waits a short gap after the last. A 429 waits for
  Retry-After when that is short, and otherwise pauses the run until
  the next one.
- 401 refreshes the person's token once.
- Every answer is parsed by a schema in service/src/spotify/schemas.ts.
- What a playlist was found to be is cached by its snapshot_id, so an
  unchanged playlist is never read again.

## Do not

- Use Spotify's private web-player endpoints, for folders or anything
  else: they break without notice and break Spotify's terms.
- Scrape or call open.spotify.com.
- Retry a 429 sooner than Retry-After says.

History: Set when the repo was made, October 2026.
