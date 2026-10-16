> **Cópia do resultado original do Codex (Codex CLI 0.157.1, `codex exec --sandbox read-only`), 2026-10-16.**
>
> Rodada: segunda verificação, das correções feitas depois da [revisão 5](revisao-5.md). Intervalo revisado: 55e2ebe..3904d6b.
> Texto preservado sem edição, exceto: caminhos absolutos do computador local (C:/dev/playlist-creator/...)
> trocados por caminhos relativos ao repositório. Não havia tokens, credenciais ou segredos para omitir.
> Os números de linha se referem ao commit 3904d6b. Vereditos e correções: [REVISAO-CODEX.md](../REVISAO-CODEX.md).

What this change does: it fixes the HTTPS logout check, serializes same-tab auth operations without Web Locks, bounds auth requests, prevents manual-search sequence collisions, and enables visibility retries for legacy publication jobs. One new availability regression remains in the refresh timeout path.

## Finding verification

| ID | Status | Justification | Would the new test fail without it? |
|---|---|---|---|
| **NEW-AUTH-1** | **FIXED** | Auth requests abort after 15 seconds, rejecting the refresh and releasing the local/Web Lock so logout can proceed. | **Yes.** The fake-timer test would hang/time out without the abort. |
| **NEW-AUTH-2** | **PARTIALLY FIXED** | The module-level fallback queue correctly orders refresh then logout in the same tab. Different tabs still have independent queues when Web Locks are absent, so a late refresh from one tab can overwrite another tab’s logout. | **Yes, for the implemented same-tab fix.** The cookie-order test fails without the fallback queue. It does not test the remaining cross-tab case. |
| **NEW-AUTH-3** | **FIXED** | HTTPS validation now happens after CSRF validation but before the early logout response. HTTP on non-loopback no longer reports successful logout without clearing the Secure cookie. | **Yes.** The new server test would receive 200 instead of 400 before the fix. |
| **NEW-APP-1** | **FIXED** | Search tokens now come from a monotonically increasing component-wide counter. Clearing the per-row map can no longer make searches from different playlists share the same token. | **Yes.** With the old per-row counter, the delayed `lenta` result is accepted as sequence 1 and overwrites the second playlist. |
| **NEW-PUB-1** | **FIXED** | The result-screen retry supplies `retryVisibility`, and completed legacy jobs missing `visibility` are checked only when that option is requested. | **Yes, at the library level.** The legacy-job test fails without the new option/branch. There is no UI test specifically proving that a legacy result button forwards the option; the existing UI test uses an explicit `unknown` job, which retried already. |
| **PUB-1** | **FIXED** | Both new and legacy jobs can now be rechecked without recreating the playlist, while confirmed visibility remains untouched. | **Yes.** The legacy-job test closes the remaining gap. |
| **AUTH-1** | **PARTIALLY FIXED** | Web Locks still provide cross-tab serialization; the fallback now adds same-tab serialization. Cross-tab refresh rotation remains possible in a browser without Web Locks. | **Partially.** The same-tab tests fail without this change, and the older injected shared-lock test checks lock use. No test exercises actual `navigator.locks` or the residual no-Web-Locks cross-tab race. |

The residual cross-tab risk without `navigator.locks` is acceptable for a single-user personal app. Current mainstream browsers support Web Locks, and the fallback protects the much more ordinary same-tab refresh/logout race. It should remain documented as a compatibility limitation.

## New finding

### Must fix

1. **NEW-AUTH-4 — Medium — A timed-out refresh can strand a rotated refresh token** ([auth.ts:93](../../src/lib/auth.ts), [authHandler.ts:170](../../server/authHandler.ts))

   - **Reproduction:** Start `/api/auth/refresh`. Let the frontend reach its 15-second deadline and abort, but allow the server handler to continue its Spotify request. If Spotify rotates the refresh token afterward, the server constructs a response containing the new cookie, but the aborted browser request cannot receive it. The browser retains the now-invalid old token; the next refresh gets `invalid_grant` and logs the user out.
   - **Why it happens:** The frontend abort signal only cancels its fetch. The server does not propagate the request signal to its Spotify fetch, and rotation occurs before the replacement cookie reaches the browser.
   - **Fix:** Do not abandon a potentially rotating refresh solely on a frontend timer. Use a coordinated server deadline shorter than the client deadline and propagate cancellation upstream. If rotation-after-cancellation cannot be ruled out, keep refresh completion durable server-side or use a logout/refresh protocol that performs a final cookie cleanup after the outstanding refresh settles.
   - **Test gap:** The timeout test models a fetch that aborts immediately and has no server-side side effect. Add a test where the client aborts but the simulated backend later rotates the token.
   - **If skipped:** A slow refresh can force an otherwise unnecessary Spotify reconnection. This is availability/session loss, not token disclosure.

No additional correctness bugs were found in the module-level fallback queue, `retryVisibility`, or monotonic search counter.

## Verification

- Read the full diff and all nine changed files.
- `npm.cmd run typecheck`: passed.
- Vitest could not start because the read-only workspace prevents Vite from creating `node_modules/.vite-temp`; no tests executed.
- `git diff --check`: passed.
- No files were modified. The existing uncommitted `.env.example` change was ignored.

**Verdict: fix NEW-AUTH-4 before shipping. The no-Web-Locks cross-tab limitation is acceptable residual risk for this personal app.**


---

<details><summary>Prompt enviado ao Codex</summary>

```text
Your verification report (docs/codex/revisao-5.md) listed new findings NEW-AUTH-1, NEW-AUTH-2, NEW-AUTH-3, NEW-APP-1 and NEW-PUB-1, plus PUB-1 and AUTH-1 as partially fixed. Fixes were committed in 55e2ebe..3904d6b. Run `git diff 55e2ebe..3904d6b` and read the full changed files. Do not modify files. Do not print secrets or tokens. Ignore the uncommitted .env.example change.

For each of those IDs answer FIXED / PARTIALLY FIXED / NOT FIXED with a short justification, and say whether the new regression tests would fail without the fix. Note: without navigator.locks, cross-tab rotation races remain possible by design (only a same-tab queue is provided; Web Locks is available in all current browsers) — say whether you consider that acceptable residual risk for a single-user personal app.

Then look for any NEW bug introduced by these fixes (e.g. the 15 s AbortController timeout in src/lib/auth.ts postAuth and how it interacts with the refresh lock, the module-level fallback queue in src/lib/session.ts, retryVisibility in src/lib/publish.ts and src/App.tsx, the monotonic searchCounter). Give ID, severity, file:line, reproduction and fix. Skip style nits. End with a verdict.
```

</details>
