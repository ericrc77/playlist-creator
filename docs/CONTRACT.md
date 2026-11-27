# Playlist contract, version 1.0

The app only publishes. Choosing the music happens beforehand (for example, in a chat with an assistant), and the
approved list is imported as JSON.

```json
{
  "schema_version": "1.0",
  "playlist": {
    "name": "Evening focus",
    "description": "Optional",
    "public": false
  },
  "tracks": [
    { "title": "Paper Lanterns", "artists": ["The Harbor Lights"] },
    { "spotify_url": "https://open.spotify.com/track/<22-character-id>" }
  ]
}
```

## Fields

| Field | Required | Rules |
|-------|----------|-------|
| `schema_version` | yes | String, `"1.0"` |
| `playlist.name` | yes | Not empty |
| `playlist.description` | no | Text |
| `playlist.public` | no | Boolean. The app always starts with "not public", even if the file asks otherwise |
| `tracks` | yes | Ordered, non-empty list. Order and intentional repetitions are preserved |
| `tracks[].title` | when there is no URI | Track name |
| `tracks[].artists` | when there is no URI | Artist names |
| `tracks[].spotify_uri` | no | `spotify:track:<id>`, checked against the API |
| `tracks[].spotify_url` | no | Track link, converted to a URI |

Files containing credential fields such as `access_token` or `client_secret` are rejected.

## Required behavior

1. Validate the file before any write request.
2. Search by title and artists, never by title alone.
3. Never silently pick a doubtful version (remix, live, acoustic, explicit or clean).
4. Publish only after an explicit action by the user.
5. Confirm the result through the API and handle expired sessions, missing scopes, 403, 429 and partial failures.
6. Never expose tokens or secrets in the file, logs or repository.
7. Use Spotify data only to resolve tracks and build the playlist; do not send it to AI models.
