> **Cópia do resultado original do Codex (Codex CLI 0.157.1, `codex exec --sandbox read-only`), 2026-10-16.**
>
> Rodada: verificação das correções da [revisão 7](revisao-7.md). Intervalo revisado: 0d79574..da68a2a.
> Texto preservado sem edição, exceto: caminhos absolutos do computador local (C:/dev/playlist-creator/...)
> trocados por caminhos relativos ao repositório. Não havia tokens, credenciais ou segredos para omitir.
> Os números de linha se referem ao commit da68a2a. Vereditos e correções: [REVISAO-CODEX.md](../REVISAO-CODEX.md).

What this change does: it fixes the three reported result-screen issues without changing `src/lib` or the playlist/item publication path. The required privacy sentence is exact, and rechecking no longer runs `publish()`.

## Recheck of prior findings

- **VIS-1 — FIXED.** Confirmed states now say “playlist pública” or “playlist não pública”; mismatch wording also avoids treating `public:false` as Spotify’s stronger “private” state. The required sentence appears exactly at [src/App.tsx:521:521](../../src/App.tsx).
  - **Would the new test fail without the fix?** Yes. The test at [tests/app.test.tsx:299:299](../../tests/app.test.tsx) fails with the old “fora do seu perfil” result text. The updated symmetric mismatch test also fails with the old “privada” wording.

- **STATE-1 — FIXED.** A new attempt clears `rechecked`, and an `unknown` result cannot show the success status ([src/App.tsx:260:260](../../src/App.tsx), [src/App.tsx:294:294](../../src/App.tsx)).
  - **Would the new test fail without the fix?** Yes against `0d79574`: the stale status remains after the failed recheck. The test at [tests/app.test.tsx:330:330](../../tests/app.test.tsx) verifies the visible result, although either the reset or the new `unknown` condition is independently enough to satisfy that assertion.

- **STATE-2 — FIXED.** The button calls `ensureVisibility()` directly and only updates the existing outcome’s visibility ([src/App.tsx:255:255](../../src/App.tsx)). It cannot create a playlist or add tracks even when the persisted job is missing.
  - **Would the new test fail without the fix?** Yes. Clearing the saved job would make the previous `publish(...retryVisibility)` route create another playlist; [tests/app.test.tsx:310:310](../../tests/app.test.tsx) checks all relevant POST counts.

The original title is preserved, including an initial `alreadyPublished:true` outcome, because rechecking only spreads the existing outcome and changes `visibility`.

## New findings

**Must fix**

1. **VIS-2 — Medium — The editor still asserts profile visibility** ([src/App.tsx:385:385](../../src/App.tsx))
   - **Reproduction:** Select the public option before publishing. The UI says “Aparece no seu perfil” and “Qualquer pessoa pode encontrar a playlist no seu perfil.”
   - **Problem:** This violates the explicit requirement never to assert profile appearance. Spotify’s `public` field does not confirm that claim.
   - **Fix:** Describe the option as “Playlist pública” / “Playlist não pública” and explain only the confirmed `public` behavior. Add a test covering the public selector text.

2. **STATE-3 — Medium — A late recheck can contaminate the next playlist’s state** ([src/App.tsx:265:265](../../src/App.tsx), [src/App.tsx:269:269](../../src/App.tsx), [src/App.tsx:314:314](../../src/App.tsx))
   - **Reproduction:** Start a slow recheck, click “Nova playlist” while it is running, and begin publishing the next playlist. When the old request finishes, it unconditionally sets `rechecked=true` and `publishing=false`.
   - **Problem:** The new result may display a recheck-success message that belongs to the old playlist. It can also re-enable UI while the new publication is still running. The playlist-ID guard protects `outcome`, but not these two state variables.
   - **Fix:** At minimum, disable “Nova playlist” while `publishing`. A request-generation guard covering all three completion updates would also make the async state robust. Add a delayed-recheck/reset regression test.

## Design choice

Calling `ensureVisibility()` directly is acceptable. Not updating the persisted job means a later `publish()` may perform one redundant visibility check for a stored `unknown`/`mismatch`, but it retains the established recovery behavior and cannot duplicate playlist creation or tracks. Keeping the now UI-unused `retryVisibility` option is also acceptable under the requirement not to change `src/lib`.

The `role="status"` condition and `role="alert"` usage are appropriate. The `wantPublic` source is safe during a normal result flow because the plan freezes the same value and editing is disabled after publication.

`src/lib` is untouched. TypeScript and `git diff --check` pass. Vitest could not start because the read-only environment prevented Vite from creating `node_modules/.vite-temp`. No files were modified, and the `.env.example` change was ignored.

**Verdict: do not ship until VIS-2 and STATE-3 are fixed.**


---

<details><summary>Prompt enviado ao Codex</summary>

```text
Your review of commit 0d79574 (saved in docs/codex/revisao-7.md) reported VIS-1, STATE-1 and STATE-2. Fixes are in commit da68a2a. Run `git diff 0d79574..da68a2a` and read src/App.tsx and tests/app.test.tsx. Do not modify files. Do not print secrets or tokens. Ignore the uncommitted .env.example change.

Constraints from the user: publishing logic must not change (src/lib untouched); the privacy message must read exactly "O Spotify manteve a playlist pública, apesar da solicitação de privacidade."; never assert the playlist appears on the profile; after rechecking, the title must not suggest a new publication.

For VIS-1, STATE-1, STATE-2 answer FIXED / PARTIALLY FIXED / NOT FIXED with justification, and whether the new tests would fail without each fix. Note the design choice: the recheck button now calls ensureVisibility directly instead of publish(), so the persisted job's visibility field is not updated by the button (a later publish of the same plan still re-checks 'unknown'/'mismatch' jobs as before); the `retryVisibility` option in src/lib/publish.ts is no longer used by the UI but kept to avoid changing src/lib. Say whether that is acceptable.

Look for any new bug (e.g. recheckVisibility when outcome changes mid-request, wantPublic source, the status condition, accessibility). Give ID, severity, file:line, reproduction and fix; skip style nits. End with a verdict.
```

</details>
