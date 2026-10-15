> **Cópia do resultado original do Codex (Codex CLI 0.157.1, `codex exec --sandbox read-only`), 2026-10-14.**
>
> Rodada: revisão completa. Estado do código revisado: commit 956f733.
> Texto preservado sem edição, exceto: caminhos absolutos do computador local (C:/dev/playlist-creator/...)
> trocados por links relativos ao repositório. Não havia tokens, credenciais ou segredos para omitir.
> Os números de linha se referem ao commit indicado. Vereditos e correções: [REVISAO-CODEX.md](../REVISAO-CODEX.md).

No high-severity issues found. The main risks are silent version matching and concurrent publication.

### Findings

**F1 — medium — concurrent publishing can duplicate playlists or tracks**  
File: [src/lib/publish.ts](../../src/lib/publish.ts#L80)

- Scenario: two tabs publish or resume the same job concurrently. Both can read the same job state, observe the same playlist prefix, and POST the same remaining batch; a fresh-job race can also create two playlists because `localStorage` is not an atomic lock.
- Minimal fix: serialize each fingerprint with `navigator.locks.request("publish-" + fp, ...)`, then reload the job inside the lock. Add an in-process guard as fallback.

**F2 — medium — a URI with a different version can be accepted silently**  
File: [src/lib/resolver.ts](../../src/lib/resolver.ts#L21)

- Scenario: JSON requests `Song` by Artist but supplies the URI for `Song - Live`. `scoreCandidate()` sees the same base title and artist; `resolveByUri()` ignores `versionMismatch` and returns `exact`.
- Minimal fix: require `s.versionMismatch.length === 0` before returning `exact`.

**F3 — medium — unknown qualifiers and subtitles are erased before matching**  
File: [src/lib/matching.ts](../../src/lib/matching.ts#L45)

- Scenario: `Song (Unplugged)`, `Song - Alternate Take`, or `Pride (In the Name of Love)` can match `Song` or `Pride` automatically. `baseTitle()` discards every parenthetical/hyphen suffix, while the finite marker list does not recognize terms such as “unplugged” or “alternate take.”
- Minimal fix: only remove known feature-credit syntax automatically. If normalized full titles otherwise differ, require confirmation unless the removed text is demonstrably equivalent on both sides.

**F4 — medium — publication jobs are shared between Spotify accounts**  
File: [src/lib/publish.ts](../../src/lib/publish.ts#L34)

- Scenario: account A publishes a plan, then account B logs in on the same browser and publishes the identical plan. The completed local job is returned as account B’s playlist, or an incomplete job points B at A’s inaccessible private playlist.
- Minimal fix: obtain `/me` once after login and namespace/bind every job to the Spotify user ID.

**F5 — low — OAuth error callbacks bypass state validation**  
File: [src/lib/auth.ts](../../src/lib/auth.ts#L87)

- Scenario: navigation to `/callback?error=access_denied` without the pending state deletes the legitimate verifier/state and reports a denial. This permits login disruption, although not account takeover.
- Minimal fix: capture and clear the stored values, validate state/verifier, and only then process `error` or `code`.

**F6 — low — omitted token scope is interpreted as no granted scope**  
File: [src/lib/auth.ts](../../src/lib/auth.ts#L141)

- Scenario: a successful initial or refresh token response omits `scope`, meaning the requested/current scope is unchanged. The app saves `scope: ''` and incorrectly reports both permissions missing.
- Minimal fix: pass a fallback scope into `readTokenResponse`; use the requested scopes initially and `current.scope` during refresh.

**F7 — low — the 32-bit job fingerprint can alias unrelated plans**  
File: [src/lib/publish.ts](../../src/lib/publish.ts#L36)

- Scenario: two different plans collide under FNV-1a. The second plan can resume or return the first plan’s playlist because the stored job does not contain the canonical plan for comparison.
- Minimal fix: store the canonical serialized plan and compare it on load, or use SHA-256 via `crypto.subtle.digest`.

### Important missing tests

- Two concurrent `publish()` calls for the same fresh and partially completed job.
- URI matching where only the version qualifier differs.
- Unknown qualifiers/subtitles such as “Unplugged,” “Alternate Take,” and meaningful parentheticals.
- Account switching with an existing job and deliberate fingerprint collision handling.
- OAuth error callback with missing/wrong state.
- Refresh response without `scope`.
- Explicit assertions that `addItems()` is not retried after network/5xx errors.

### Areas that look correct

- PKCE verifier/state use unbiased cryptographic randomness with ample entropy.
- Verifier/state are one-use and removed before token exchange.
- Tokens stay in `sessionStorage`; no token logging was found.
- The callback URL is removed from browser history before exchange, with a `no-referrer` policy.
- Refreshes are coalesced, and API 401 refresh happens once.
- 403 and 429 have clear handling; `Retry-After` is honored.
- Network/5xx retries apply to reads, while playlist-creation and item-addition POSTs are not retried automatically after ambiguous failures. Their 401/429 replays occur only after explicit rejection responses.
- Partial-write recovery verifies Spotify state before continuing, and final order is verified exactly.
- The specified February 2026 endpoints and limits are used correctly.

Tests could not be executed under the read-only workspace because Vite attempted to create `node_modules/.vite-temp`; review remained read-only.