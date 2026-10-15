> **Cópia do resultado original do Codex (Codex CLI 0.157.1, `codex exec --sandbox read-only`), 2026-10-14.**
>
> Rodada: re-verificação das correções. Estado do código revisado: commit 99fbee2.
> Texto preservado sem edição, exceto: caminhos absolutos do computador local (C:/dev/playlist-creator/...)
> trocados por links relativos ao repositório. Não havia tokens, credenciais ou segredos para omitir.
> Os números de linha se referem ao commit indicado. Vereditos e correções: [REVISAO-CODEX.md](../REVISAO-CODEX.md).

### Re-verification

- **F1 — FIXED:** `serialized()` queues same-job calls, uses an origin-wide Web Lock across tabs, and reloads the job while locked ([publish.ts](../../src/lib/publish.ts#L68)).
- **F2 — PARTIALLY FIXED:** URI matches now check strict titles and version markers, but subtitles such as `Song (With Orchestra)` are erased as credits and still accepted silently ([resolver.ts](../../src/lib/resolver.ts#L23)).
- **F3 — PARTIALLY FIXED:** most unknown complements are preserved, but `CREDIT_IN_BRACKETS` removes every `(with …)` subtitle, and `CREDIT_SUFFIX` mistakes real titles such as `Song Part. II` for participation credits ([matching.ts](../../src/lib/matching.ts#L71)).
- **F4 — FIXED:** the Spotify owner is included in both the persisted job key and serialization key ([publish.ts](../../src/lib/publish.ts#L47)).
- **F5 — FIXED:** expected state and verifier are validated before any OAuth error is trusted ([auth.ts](../../src/lib/auth.ts#L89)).
- **F6 — FIXED:** omitted scope now preserves the requested scope after login and the previous scope after refresh ([auth.ts](../../src/lib/auth.ts#L143)).

### New regressions

- **Publishing can fail at `/me`:** the app requests only playlist scopes, while Spotify documents `user-read-private` for the current-profile endpoint now called before every publication ([auth.ts](../../src/lib/auth.ts#L8), [publish.ts](../../src/lib/publish.ts#L100), [Spotify reference](https://developer.spotify.com/documentation/web-api/reference/get-current-users-profile)).
- **Unstable account key:** the code uses profile `id`; Spotify explicitly says to use immutable `account_id` for account linking. An ID change would orphan the saved job and permit another playlist ([Spotify reference](https://developer.spotify.com/documentation/web-api/reference/get-current-users-profile)).

**F7:** Agree with leaving it unfixed under the stated low plan count and compound key. The residual collision risk is negligible.

TypeScript passes. The test suite could not start because the read-only environment prevented Vite from creating its temporary config file.