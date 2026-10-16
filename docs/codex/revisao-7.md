> **Cópia do resultado original do Codex (Codex CLI 0.157.1, `codex exec --sandbox read-only`), 2026-10-16.**
>
> Rodada: revisão das correções de texto da tela de resultado (commit 0d79574), pedidas depois do teste real com o Spotify.
> Texto preservado sem edição, exceto: caminhos absolutos do computador local (C:/dev/playlist-creator/...)
> trocados por caminhos relativos ao repositório. Não havia tokens, credenciais ou segredos para omitir.
> Os números de linha se referem ao commit 0d79574. Vereditos e correções: [REVISAO-CODEX.md](../REVISAO-CODEX.md).

What this change does: it adds the requested mismatch wording and preserves the original publication title after a normal visibility recheck. Publishing code under `src/lib` is unchanged, and the new primary regression test would fail if either requested fix were reverted.

**Must fix**

1. **VIS-1 — High — Confirmed states still claim more than the API confirms** ([src/App.tsx:504](../../src/App.tsx), [src/App.tsx:529](../../src/App.tsx))
   - **Reproduction:** An `ok` or `corrected` result renders “no seu perfil” or “fora do seu perfil”, although the response only confirms the `public` boolean. For a public request returning `mismatch`, `public:false` is also described as fully “privada”, despite the app’s own distinction from Spotify’s “Tornar privada”.
   - **Fix:** Describe only the field: “pública” and “não pública”, including the public-request mismatch. Keep the required private-request message exactly as specified. The `unknown` wording already avoids asserting a result.

**Should fix**

2. **STATE-1 — Medium — A failed repeated recheck can leave a stale success status** ([src/App.tsx:248](../../src/App.tsx), [src/App.tsx:278](../../src/App.tsx))
   - **Reproduction:** Let a mismatch recheck complete while Spotify still ignores the change; `rechecked` becomes true. Click recheck again and make `/me` throw. After the exception, the alert shows the error but the old status returns saying visibility was checked again.
   - **Fix:** Clear `rechecked` when a recheck starts, then set it only after that attempt returns `done`.

3. **STATE-2 — Medium — A non-`done` recheck discards the original result screen** ([src/App.tsx:243](../../src/App.tsx))
   - **Reproduction:** If a visibility recheck returns `uncertain_create` or `diverged`, the fallback assigns that outcome and removes the original title entirely. An `uncertain_create` result can then show a control suggesting playlist creation, although the action was presented as only a visibility check.
   - **Fix:** During `retryVisibility`, preserve the previous `done` outcome for every non-`done` result and expose the returned condition as an error/status on that result screen.

The new tests cover both headline regressions and independently fail if either the required mismatch text or normal recheck title preservation is removed. They do not cover an initially `alreadyPublished` result, exception handling, non-`done` rechecks, reset after recheck, or the complete `ok`/`corrected` public/private text matrix; those omissions allowed the findings above.

The new `role="alert"` is appropriate for recheck failures, and `role="status"` is suitable for non-urgent completion feedback. Its state accuracy needs the STATE-1 correction. “Nova playlist” correctly clears `rechecked` through `unlock()`.

`src/lib` is untouched, the frozen plan and publication call are unchanged, and the normal recheck tests assert no additional playlist or item POST. TypeScript and `git diff --check` pass. Vitest could not execute because the read-only environment blocked its temporary directories; no tests ran.

Verdict: fix VIS-1, STATE-1, and STATE-2 first.


---

<details><summary>Prompt enviado ao Codex</summary>

```text
Review the last commit (git diff HEAD~1..HEAD) of this repository. Do not modify files. Do not print secrets or tokens. Ignore the uncommitted .env.example change.

Context: in a real test, Spotify kept a playlist public although the app requested public:false and then retried PUT {public:false}; the app correctly detected 'mismatch'. The user asked for two UI text fixes only, without changing publishing logic:
1. The privacy message must read: "O Spotify manteve a playlist pública, apesar da solicitação de privacidade." The UI must not claim the playlist appears on the profile unless that was confirmed (the API only confirms the `public` field).
2. After clicking "Conferir visibilidade de novo", the title must stay clear and must not suggest a new publication (previously it switched to "Essa playlist já estava publicada").

Check: (a) the texts for every visibility state (ok, corrected, mismatch, unknown) and both requested values (public true/false) are accurate and never assert more than the API confirmed; (b) the title/status logic in src/App.tsx doPublish/setOutcome/rechecked is correct, including when the first result was already alreadyPublished, when the recheck fails with an exception, when it returns a non-'done' outcome, and after "Nova playlist"/reset; (c) no change to publishing behavior (src/lib untouched; same plan, no new playlist, no new items); (d) the new tests in tests/app.test.tsx really exercise both fixes and would fail without them; (e) accessibility of the new role=status / role=alert elements.

Give findings with ID, severity, file:line, reproduction and fix; skip style nits. End with a verdict.
```

</details>
