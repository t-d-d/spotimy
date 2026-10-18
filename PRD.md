# spotimy: product requirements, version 1

## The problem

Thomas and his brother listen to whole albums. For years each of them has kept every album as its own Spotify playlist, named "Artist – Album", inside a folder for each year. They follow each other's playlists, so each library holds both sets. Spotify now treats albums as things you can save, and saving one is the quicker way to add a new one. They want both views of the same set: every album saved, and every album also a playlist they can file in a year folder.

## Who it is for

A group of up to five Spotify accounts, the most a Spotify app in development mode admits. Each person signs in once.

## What version 1 does

1. **Sign in with Spotify.** Only the accounts listed in the Spotify app's User Management can sign in. Whoever signs in joins the group.
2. **Find what each playlist is.** A run reads every member's playlists. A member's own playlist is read track by track with their own token. A playlist owned by someone outside the group, whose tracks Spotify will not show, is matched by its name and confirmed by its cover art.
3. **Plan, for each person:**
   - save the album behind every playlist that is mostly one whole album,
   - follow each album playlist another member owns that this person has no playlist for, and save its album,
   - make a playlist, "Artist – Album", for each saved album with no playlist, and say which year folder it belongs in.
4. **Show the plan** on a page, with what was left alone and why: playlists of several albums, partial albums, and names that matched nothing.
5. **Apply** what the plan on the page says when the person presses Apply, and nothing that turned up since. Each morning, apply the whole plan for anyone who turned that on and has pressed Apply once themselves.
6. **Never take anything away.** A run only saves, follows and makes. Something a person removed after a run is never put back.
7. **Leave.** A person can leave, and spotimy forgets their tokens and everything it kept about them.

## Out of scope

- Playlist folders. Spotify's Web API has no access to them, so new and followed playlists appear at the top of the library and each person drags them into place.
- Removing, unfollowing or unsaving anything.
- More than one group, or more than five people.
- Playlists that are not albums.
- Any Spotify endpoint outside the documented Web API.

## Roadmap

In rough order of value:

- **A weekly email** of what changed, so nobody needs to open the page.
- **Forget a removal**, so a person can let a run add something back.
- **Mutation testing** of the planner, run by hand like askme-mcp's.
