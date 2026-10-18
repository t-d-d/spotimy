# Spotify Web API
Relevance: Any call to Spotify, its schemas, or how the sync reads a library: service/src/spotify/**, service/src/sync/**
Decision: Only Spotify's documented Web API, as a development-mode app allows it, paced, with every answer parsed and every limit respected.

Why: The app runs in Spotify's development mode, which caps users at
five, limits the endpoints, and shares one rate limit across all of
the owner's apps. The playlist folders people use are not in the API.

## Rules

- Call only documented endpoints, under their February 2026 names:
  /me/library to save and follow, /playlists/{id}/items for a
  playlist's tracks, /me/playlists to create one. Never the removed
  /playlists/{id}/tracks.
- A playlist's tracks can be read only by its owner or a collaborator.
  A member's playlists are read with that member's own token.
- A playlist owned by someone outside the group is identified from its
  name and confirmed by its cover art, the album's own image when the
  playlist holds one album. A match by name alone is marked as such.
- Every call waits a short gap after the last. A 429 waits for
  Retry-After while the call's waits add up to 45 seconds or less, and
  otherwise stops the run. The next run starts from what it found.
- spotimy keeps its own allowance of 1,000 calls a UTC day for the
  whole group, counted in the table, well under Spotify's unpublished
  limit. A run looks at playlists only while the day's count is under
  600, and applies only while it is under 1,000. What is left waits for
  the next day's run.
- 401 refreshes the person's token once.
- Every answer is parsed by a schema in service/src/spotify/schemas.ts.
- What a playlist was found to be is cached by its snapshot_id, so an
  unchanged playlist is never read again.

## Do not

- Use Spotify's private web-player endpoints, for folders or anything
  else: they break without notice and break Spotify's terms.
- Scrape or call open.spotify.com.
- Retry a 429 sooner than Retry-After says.

History: Set when the repo was made, October 2026. The daily allowance
added in #8, after a first sweep drew a 21-hour Retry-After.
