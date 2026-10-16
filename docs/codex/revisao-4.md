> **Cópia do resultado original do Codex (Codex CLI 0.157.1, `codex exec --sandbox read-only`), 2026-10-16.**
>
> Rodada: revisão adversarial de segurança, autenticação e publicação. Intervalo revisado: dc68418..7bb48bb.
> Texto preservado sem edição. Não havia caminhos absolutos, tokens, credenciais ou segredos para omitir
> (o Client ID e o SESSION_SECRET locais não foram passados ao Codex). O prompt enviado está no fim.
> Os números de linha se referem ao commit 7bb48bb. Vereditos e correções: [REVISAO-CODEX.md](../REVISAO-CODEX.md).

What this change does: Moves refresh-token storage into an AES-GCM-encrypted, HttpOnly cookie handled by a small server layer. Access tokens remain in browser memory, with automatic session restoration and refresh.

Assumed load: one user, potentially with several tabs open.

## Must fix

1. **APP-1 — High — An in-flight manual search can change the plan after publishing is locked**  
   `src/App.tsx:138`, `src/App.tsx:195`, `src/App.tsx:493`

   - **Scenario:** Start a manual search, then select one of the existing candidates and press Publish before the search returns. The delayed search response clears `choice` at line 147 after `attempted` is already true. Its radio buttons remain enabled, so the user can choose a different track. A retry then uses a different fingerprint and can create a second playlist, especially after a failed add or uncertain create.
   - **Fix:** Freeze an immutable `PublishPlan` on the first attempt and use it for every retry. Also invalidate pending searches when publishing starts and disable all `TrackReview` controls after `attempted`; clear the current choice immediately when a manual search starts.

2. **PUB-1 — Medium — Visibility can remain wrong while the UI reports the requested value as fact**  
   `src/lib/publish.ts:193`, `src/lib/publish.ts:204`, `src/App.tsx:232`, `src/App.tsx:427`

   - **Scenario:** Spotify creates a public playlist although `public: false` was requested, then the visibility GET or PUT fails temporarily. `ensureVisibility` returns `unknown`, but the job was already saved as `done`. The result says “fora do seu perfil,” and later retries return the completed job without checking visibility again.
   - **Fix:** Persist visibility confirmation separately and retry it while its state is `unknown` or `mismatch`. The UI must say “visibilidade não confirmada” for `unknown`, rather than displaying the requested value as confirmed.

## Should fix

3. **AUTH-1 — Medium — Refresh-token rotation races across tabs can erase a valid session**  
   `src/lib/session.ts:31`, `server/authHandler.ts:158`

   - **Scenario:** Two tabs restore simultaneously using refresh token RT1. Tab A receives RT2 and sets the new cookie. If Spotify invalidates RT1, tab B receives `invalid_grant` and its later response clears the cookie containing RT2. The per-instance `refreshing` promise only coalesces calls within one page.
   - **Fix:** Serialize refresh and logout across same-origin tabs with one Web Lock, placing the actual fetch inside the lock. This makes the waiting tab send the cookie produced by the first refresh. Add a two-tab rotation regression test.

4. **AUTH-2 — Medium — Logout silently succeeds in the UI even when the cookie was not cleared**  
   `src/lib/auth.ts:138`, `src/lib/session.ts:64`, `server/authHandler.ts:120`

   - **Scenario:** Go offline and press Sair. The network failure is swallowed, memory is cleared, and the UI reports logout. Once connectivity returns, reloading restores the session from the untouched cookie. Server configuration errors also prevent logout because configuration is checked before the logout branch.
   - **Fix:** Do not swallow logout failures; verify a successful response and tell the user when server-side logout was not confirmed. Handle `logout` before client-ID/session-secret validation, since deleting the cookie requires neither.

5. **AUTH-3 — Medium — Every Spotify 400/401 refresh response is treated as `invalid_grant`**  
   `server/authHandler.ts:163`, `server/authHandler.ts:197`

   - **Scenario:** A temporary deployment has the wrong client ID. Spotify returns `400 invalid_client`; the handler labels the user session expired and deletes an otherwise usable cookie. Correcting the configuration cannot recover it.
   - **Fix:** Preserve Spotify’s OAuth `error` field in `spotifyToken`. Clear the cookie only for `invalid_grant` or an explicitly confirmed revoked/expired token; return a configuration/upstream error for `invalid_client`, `invalid_request`, and similar responses.

## Nice to have

6. **AUTH-4 — Low — Cookie expiry is enforced only by the browser**  
   `server/authHandler.ts:18`, `server/authHandler.ts:28`, `server/authHandler.ts:91`

   - **Scenario:** A sealed cookie copied before expiry can be replayed manually after 180 days because the encrypted payload contains no issuance or expiry time. The server will accept it as long as the secret and Spotify refresh token remain valid.
   - **Fix:** Include `iat` and `exp` in the authenticated payload and reject expired sessions in `openSession`. Continue using `Max-Age` for normal browser cleanup.

## Verified as correct

- AES-GCM uses a fresh 96-bit random IV; WebCrypto appends and authenticates the GCM tag. Tampering causes decryption failure.
- Production cookies correctly use `__Host-`, `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, and no `Domain`. Loopback-only HTTP uses the unprefixed development cookie.
- Refresh-token fallback and rotation are correct for a single request: a returned token replaces the old one; an omitted token preserves it.
- POST plus the custom header, strict SameSite cookie, and exact Origin comparison adequately block ordinary browser CSRF. `Origin: null` is rejected; missing Origin is still protected by the non-simple header. Default ports and hostname case are normalized through `URL`.
- No practical Host-header redirect attack was found under Vercel’s managed routing. The redirect URI is not accepted from the request body.
- PKCE state and verifier are validated and removed before exchange. The StrictMode-wide `startPromise` prevents exchanging the callback code twice.
- Access and refresh tokens are not written to `localStorage` or `sessionStorage`; the access token remains in memory.
- Ambiguous and not-found tracks cannot normally be published until explicitly selected or skipped.
- Add-item recovery and same-job serialization prevent normal double-click duplication.
- The Vercel function uses the currently supported web-standard `Request`/`Response` handler and defaults to the Node runtime. Named HTTP exports are supported by the [Vercel Functions API](https://vercel.com/docs/functions/functions-api-reference).
- The rewrite excludes `/api/*`, still sends `/callback` to the SPA, and uses a supported negative-lookahead pattern documented by [Vercel](https://vercel.com/docs/project-configuration/vercel-json).
- CSP blocks third-party scripts, frames, foreign form targets, and unauthorized API connections. Spotify authorization is top-level navigation, so it does not require `accounts.spotify.com` in `connect-src`.
- `npm run typecheck` passes. The Vitest suite could not run because the read-only environment prevented Vitest from creating temporary files.

Verdict: fix APP-1 and PUB-1 before shipping; AUTH-1 through AUTH-3 should follow before relying on persistent sessions.


---

<details><summary>Prompt enviado ao Codex</summary>

```text
You are doing an adversarial security and correctness review of the git range dc68418..7bb48bb in this repository (run `git diff dc68418..7bb48bb` and read the full files). Do not modify files. Do not print any secrets or tokens.

Context: a personal web app that publishes playlists to Spotify from a pasted JSON plan. This range moves OAuth from a pure-browser PKCE flow to a small server (Vercel Functions in prod, Vite middleware in dev) that keeps the refresh token in an encrypted cookie, while the access token stays only in browser memory.

Focus areas:
1. server/authHandler.ts: AES-GCM encrypted cookie (key derivation, IV reuse, auth tag, tampering, expiry), __Host- prefix / Secure / HttpOnly / SameSite / Path, CSRF protection via POST + X-MUM header + Origin check (bypasses? null origin? missing origin? case/port differences?), redirect_uri derivation from the request (Host header injection, X-Forwarded-* trust), state/PKCE verifier handling, refresh token rotation (Spotify may or may not return a new refresh_token), invalid_grant handling (cookie cleared?), error leakage.
2. api/auth/[action].ts: is it compatible with Vercel Functions (Node runtime, request/response types, dynamic route param, body parsing)?
3. server/devMiddleware.ts: anything exposing the dev server unsafely.
4. src/lib/auth.ts and src/lib/session.ts: single-flight refresh, restore on load, logout, token only in memory (never localStorage/sessionStorage), races.
5. src/main.tsx: OAuth callback handling under React StrictMode (double effects, code exchanged twice).
6. src/App.tsx: paste → review → publish flow; ambiguous tracks must be confirmed before publish; UI locks after the publish attempt; any path that could publish a wrong track or create duplicate playlists.
7. src/lib/publish.ts ensureVisibility.
8. vercel.json: CSP correctness, and rewrites that must not break /api/* and /callback.

For each finding give: ID, severity (critical/high/medium/low/info), file:line, a concrete reproduction or failure scenario, and a suggested fix. Be concrete; skip style nits. If something is correct, say so briefly. End with a short list of what you verified as correct.
```

</details>
