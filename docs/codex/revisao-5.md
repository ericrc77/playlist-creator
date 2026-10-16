> **Cópia do resultado original do Codex (Codex CLI 0.157.1, `codex exec --sandbox read-only`), 2026-10-16.**
>
> Rodada: verificação das correções da [revisão 4](revisao-4.md). Intervalo revisado: 7bb48bb..d572db0.
> Texto preservado sem edição, exceto: caminhos absolutos do computador local (C:/dev/playlist-creator/...)
> trocados por caminhos relativos ao repositório. Não havia tokens, credenciais ou segredos para omitir.
> Os números de linha se referem ao commit d572db0. Vereditos e correções: [REVISAO-CODEX.md](../REVISAO-CODEX.md).

What this change does: it addresses all six original findings, but AUTH-1 and PUB-1 remain incomplete in edge cases. I found four new correctness/security regressions. No files were modified, and `.env.example` was ignored.

## New findings

### Must fix

1. **NEW-AUTH-1 — Medium — Logout can wait forever behind a refresh** ([session.ts:45](../../src/lib/session.ts), [session.ts:84](../../src/lib/session.ts))

   - **Reproduction:** Start a refresh whose request never resolves, then click “Sair.” The refresh holds `mum.auth`; logout waits for the same lock indefinitely. `main.tsx` receives neither success nor rejection, so the UI remains connected without explaining why.
   - **Suggested fix:** Give refresh requests a timeout/abort path and let logout cancel an in-flight local refresh before acquiring the lock. For cross-tab cancellation, broadcast the logout intent before waiting for the lock.
   - **Test gap:** The late-refresh test explicitly supplies a no-op lock, so it does not exercise this behavior.

2. **NEW-AUTH-2 — Medium — Without Web Locks, a late refresh can recreate the cookie after successful logout** ([session.ts:19](../../src/lib/session.ts), [session.ts:46](../../src/lib/session.ts), [session.ts:84](../../src/lib/session.ts))

   - **Reproduction:** In a browser without `navigator.locks`, start refresh, then logout. Let logout’s response clear the cookie first; afterward, let the refresh response arrive with `Set-Cookie`. `generation` prevents the access token from being restored in memory, but it cannot prevent the browser from accepting the late cookie. Reloading reconnects the supposedly logged-out user.
   - **Suggested fix:** Provide real fallback coordination, such as a `BroadcastChannel`-based logout/refresh protocol plus a local mutex and abortable requests. At minimum, do not silently fall back to fully concurrent refresh/logout.
   - **Test gap:** The existing generation test checks only `session.current`; its fake fetch does not model response-ordered cookie updates.

3. **NEW-AUTH-3 — Medium — Logout bypasses the HTTPS requirement** ([authHandler.ts:124](../../server/authHandler.ts))

   - **Reproduction:** POST a valid same-origin `X-MUM: 1` logout request to an HTTP, non-loopback deployment. It returns 200 before reaching the HTTPS check at line 137. The browser cannot reliably clear the production `Secure` cookie over HTTP, yet the client reports logout as successful.
   - **Suggested fix:** Perform the loopback/HTTPS validation immediately after CSRF validation and before the early logout branch. Only the configuration checks should remain after logout.
   - **Protection status:** Logout is still behind POST, `X-MUM`, and Origin validation, but not HTTPS.
   - **Test gap:** The regression test covers Origin but not insecure transport.

4. **NEW-APP-1 — Medium — Search sequence numbers can collide after reset** ([App.tsx:140](../../src/App.tsx), [App.tsx:146](../../src/App.tsx), [App.tsx:159](../../src/App.tsx))

   - **Reproduction:** Start manual search A for track index 0, reset/load another playlist, then start search B for its index 0. `unlock()` clears the map, so both searches receive sequence 1. If A returns while B is pending, A is considered current and replaces the new playlist’s candidates.
   - **Suggested fix:** Use a monotonic counter that is never reset, or include a playlist/load generation in each search token. Clearing the per-row map must also invalidate all older generations.
   - **Test gap:** APP-1’s new test covers a late response after publishing, not a late response crossing reset/load.

### Should fix

5. **NEW-PUB-1 — Medium — “Conferir visibilidade de novo” does nothing for legacy jobs** ([publish.ts:126](../../src/lib/publish.ts), [App.tsx:479](../../src/App.tsx))

   - **Reproduction:** Load a completed job saved before `visibility` existed. Publishing returns `visibility: 'unknown'`, so the result shows the retry button. Clicking it reloads the same job, but the retry condition accepts only an explicitly persisted `'unknown'` or `'mismatch'`; no visibility request is made.
   - **Suggested fix:** Add an explicit `retryVisibility` option used by the result-screen button. This can recheck legacy jobs only after the user asks, without automatically overriding visibility they may have changed in Spotify.
   - **Test gap:** No test seeds a completed legacy job lacking `visibility`.

## Original findings

| ID | Status | Justification | Regression-test assessment |
|---|---|---|---|
| **APP-1** | **FIXED** | The first plan is frozen, publishing invalidates pending searches, choices refuse changes after freezing, and controls are disabled. Result-screen retries reuse the same plan/job, so they do not publish a different plan or create a duplicate playlist. | The delayed-search test reproduces the original timing and would fail against the old code. It does not independently prove the frozen-plan fallback or every disabled fieldset control. |
| **PUB-1** | **PARTIALLY FIXED** | New jobs persist visibility, retry only `'unknown'`/`'mismatch'`, and no longer report unconfirmed visibility as fact. Legacy jobs without the field cannot actually be rechecked through the offered button. | The new-job unknown/mismatch tests and UI test would fail without the fix. No legacy-job regression test exists. |
| **AUTH-1** | **PARTIALLY FIXED** | The Web Lock correctly serializes the actual refresh request across tabs, with no nested acquisition or same-lock deadlock. The original rotation race remains when `navigator.locks` is unavailable. | The injected shared-lock two-tab test models rotation and would fail if lock wrapping were removed. It does not exercise the browser API or missing-lock fallback. |
| **AUTH-2** | **FIXED** | Network/non-2xx logout errors propagate, the session stays connected on failure, `main.tsx` displays the error, and server logout no longer depends on Client ID or session secret. | Client offline/server-error and server misconfiguration tests would fail without the fix. Root-level rendering of the logout error is not directly tested. |
| **AUTH-3** | **FIXED** | Spotify’s OAuth error is preserved, and only exact `invalid_grant` clears the cookie. Other 400/401 responses become 502 without `Set-Cookie`. | The parameterized `invalid_client`/`invalid_request` tests would fail against the old behavior. |
| **AUTH-4** | **FIXED** | `exp` is authenticated inside the sealed payload, checked server-side, refreshed on rotation, and old payloads without `exp` are rejected as intended. | Expired-cookie and legacy-cookie tests directly exercise both failure paths and would fail without the fix. |

## Verification

- Read the complete diff and every changed source/test file.
- `npm.cmd run typecheck`: passed.
- Vitest could not execute in the read-only sandbox: Vite first attempted `.vite-temp`, and the runner loader then attempted to create worker directories under the system temp directory. No tests actually ran.
- No secrets or token values were printed.

**Verdict: do not ship yet. Fix NEW-AUTH-1 through NEW-AUTH-3 and NEW-APP-1 first; also repair the legacy visibility retry before calling PUB-1 complete.**


---

<details><summary>Prompt enviado ao Codex</summary>

```text
You previously reviewed git range dc68418..7bb48bb of this repository (your report is saved in docs/codex/revisao-4.md). Fixes were committed in 7bb48bb..d572db0. Verify them adversarially. Run `git diff 7bb48bb..d572db0` and read the full changed files. Do not modify files. Do not print secrets or tokens. Ignore the uncommitted change to .env.example (it is local and will not be committed).

For each original finding (APP-1, PUB-1, AUTH-1, AUTH-2, AUTH-3, AUTH-4), answer FIXED / PARTIALLY FIXED / NOT FIXED with a short justification, and check that the new regression tests actually exercise the failure (would fail without the fix).

Then look for NEW bugs introduced by the fixes, especially:
- src/lib/session.ts: the Web Lock wrapper and the `generation` counter (deadlocks, refresh inside lock calling something that takes the same lock, logout failing while a refresh is pending, behavior when navigator.locks is missing).
- src/lib/auth.ts logout error handling; src/main.tsx onLogout.
- server/authHandler.ts: logout handled before config checks (still behind POST + X-MUM + Origin + HTTPS?), exp inside the sealed cookie (sliding expiry; old cookies without exp are rejected, forcing one re-login, which is accepted), invalid_grant-only cookie clearing.
- src/lib/publish.ts: persisted visibility, retry only for 'unknown'/'mismatch', legacy jobs without the field.
- src/App.tsx: frozenPlan ref, searchSeq invalidation, fieldset disabled, 'Conferir visibilidade de novo' button on the result screen (could it publish a different plan or create a duplicate playlist?).

Give each new finding an ID, severity, file:line, concrete reproduction and a suggested fix. Skip style nits. End with a verdict.
```

</details>
