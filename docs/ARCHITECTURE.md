# Architecture decisions

## 1. Backend for frontend only for authentication

The app uses Authorization Code with PKCE, so there is no client secret. Staying signed in between visits requires
keeping the refresh token, and storing it in `localStorage` would expose a long-lived credential to any injected
script. A small function (`/api/auth/exchange`, `refresh`, `logout`) keeps it in an encrypted `HttpOnly` cookie
instead. There is no database: the session lives entirely in the cookie.

Alternatives rejected: refresh token in `localStorage`, and a confidential client with a secret (one more secret to
protect, with no benefit over PKCE).

## 2. Conservative matching

A track is "found" only when the title matches after removing featuring credits, every requested artist is present,
no version marker differs (remix, live, acoustic, sped up and similar) and all exact candidates are the same
recording (duration within 3 seconds and same explicit flag). Anything else requires a choice, including skipping.

## 3. Idempotent, resumable publishing

- A job keyed by a hash of the plan (name, description, visibility, ordered URIs) is saved before each write.
- Publishing a finished plan again returns the same playlist.
- On resume, the real playlist content wins over the saved counter; if it diverged, nothing else is added.
- If playlist creation got no response, the app asks the user to check Spotify before creating again.
- Non-idempotent `POST` requests are not retried after a 5xx or network error. `429` respects `Retry-After`, and a
  `401` refreshes the token once.
- Jobs are separated by Spotify account and serialized within a tab and across tabs (Web Locks).
- After the first attempt the plan is frozen, so an edit cannot create a second playlist.

## 4. Verification against the API

Publishing is reported as complete only when the playlist returns exactly the planned tracks in order. Visibility is
read back and corrected when possible; the interface states only what the API confirmed.

## 5. Demo mode runs production code

`/demo` swaps the `fetch` function of the API client for an in-memory implementation. Matching, publishing and the
interface are the same code used in production. The demo uses throwaway storage, fictional music, and never calls
the authentication routes.

## 6. Spotify API constraints

The client follows the 2026 Development Mode endpoints: `POST /me/playlists`, `/playlists/{id}/items` in batches of
up to 100, search limited to 10 results and single-track lookups.
