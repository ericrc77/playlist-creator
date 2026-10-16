> **Cópia do resultado original do Codex (Codex CLI 0.157.1, `codex exec --sandbox read-only`), 2026-10-16.**
>
> Rodada: revisão da correção do erro 500 na Vercel (`ERR_MODULE_NOT_FOUND` em `/api/auth/*`), antes do commit.
> Texto preservado sem edição, exceto: caminhos absolutos do computador local (C:/dev/playlist-creator/...)
> trocados por caminhos relativos ao repositório. Não havia tokens, credenciais ou segredos para omitir.
> Depois desta revisão, o achado TEST-1 (baixa) foi corrigido: a checagem estática passou a cobrir aspas duplas,
> imports de efeito colateral, re-exports e `import()`. Resumo: [REVISAO-CODEX.md](../REVISAO-CODEX.md).

What this change does: it fixes Node ESM resolution for the Vercel auth function by preserving explicit `.js` specifiers after TypeScript compilation. The new test reproduces the emitted JavaScript layout and invokes it in native Node, outside Vite’s resolver.

No blocking findings.

**Non-blocking finding**

1. **TEST-1 — Low — static import check misses valid syntax** ([tests/vercelFunction.test.ts:41](../../tests/vercelFunction.test.ts))
   - **Reproduction:** Change `server/devMiddleware.ts` to use an extensionless relative import with double quotes, a side-effect import, or a re-export. The static check still passes, and the subprocess does not import `devMiddleware.ts`.
   - **Fix:** Inspect TypeScript `ImportDeclaration`/`ExportDeclaration` nodes, or broaden the check to cover both quote styles, side-effect imports, re-exports, and dynamic imports.
   - **Impact:** This does not weaken coverage of the reported production failure—the subprocess catches the actual `api/auth/[action] → authHandler` regression—but the claim that every relative import under `api/` and `server/` is checked is broader than the implementation.

**Review conclusions**

1. **Root cause and Vercel fix:** Correct. The Vercel Node builder traces dependencies with TypeScript support, compiles traced `.ts` files, and renames their outputs to `.js`; it does not rewrite an extensionless ESM specifier into an explicit one. The `.js` specifier is therefore the correct source-level form and allows the traced `authHandler.ts` to become `server/authHandler.js` at runtime. See Vercel’s [Node builder implementation](https://github.com/vercel/vercel/blob/main/packages/node/src/build.ts#L135-L148) and its [trace/compile path](https://github.com/vercel/vercel/blob/main/packages/node/src/build.ts#L187-L329).

   The bracketed filename does not affect module resolution. It already reached the function in production, and `pathToFileURL()` safely encodes it in the regression test. Named `GET`/`POST` exports using Web `Request` and `Response` are explicitly supported by the [Vercel Node runtime](https://vercel.com/docs/functions/runtimes/node-js). The Vite preset still supports root-level `api/` functions, per [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite). The rewrite excludes paths beginning with `api/`, so it does not intercept these endpoints.

2. **Transitive imports:** No remaining production-runtime import problem found. `api/auth/[action].ts` imports only `server/authHandler.ts`, and that file has no imports. Its `Buffer`, `crypto`, `fetch`, `Request`, and `Response` uses are Node 24 globals/Web APIs. In `devMiddleware.ts`, `node:http` and `vite` are type-only imports and are erased; `node:crypto` is a supported built-in.

3. **Regression fidelity:** The subprocess test would fail without the fix: TypeScript preserves `../../server/authHandler`, and native ESM Node would search for that exact extensionless path even though `authHandler.js` exists. With the fix it imports the bracketed file and verifies execution reached application logic by expecting 401.

   Its portability choices are sound: `mkdtempSync(tmpdir())`, `process.execPath`, `pathToFileURL()`, path helpers, and recursive cleanup work on Windows and Linux. It is not a full reproduction of Vercel’s file tracer, but it accurately reproduces the runtime failure mode; Vercel’s builder source confirms the missing tracing/compilation piece.

4. **Security and publishing:** Unchanged. The tracked production edits only alter module specifiers. PKCE parameters, refresh-token encryption/cookies, CSRF checks, token rotation, Spotify calls, and playlist publishing logic are untouched.

5. **Local development:** Expected to remain working. TypeScript with `moduleResolution: "bundler"` resolves `./authHandler.js` to `authHandler.ts`, and Vite does the same. `tsc --noEmit` passed. Vite/Vitest also loaded the config and resolved the middleware import before the read-only sandbox prevented creation of its temporary cache.

Test execution note: the new Vitest test could not run to completion in this read-only review environment because Vite/Vitest received `EPERM` while creating temporary cache directories. This was an environment restriction, not a test assertion failure.

Verdict: APPROVED


---

<details><summary>Prompt enviado ao Codex</summary>

```text
Review the uncommitted working-tree changes in this repository (run `git diff` and `git status`; the new file is tests/vercelFunction.test.ts). Do not modify files. Do not print secrets or tokens. Ignore the .env.example change (local only, will not be committed).

Production problem: on Vercel (Node.js 24, package.json "type": "module"), /api/auth/refresh and /api/auth/exchange return 500 with ERR_MODULE_NOT_FOUND "Cannot find module '/var/task/server...'". api/auth/[action].ts imported '../../server/authHandler' without extension. Vercel compiles each TypeScript file to JS without bundling and Node ESM requires explicit extensions for relative imports.

Fix applied: '.js' extension on the relative imports in api/auth/[action].ts and server/devMiddleware.ts (tsconfig uses moduleResolution "bundler"; Vite/Vitest resolve .js to .ts). Regression test: tests/vercelFunction.test.ts transpiles api/ and server/ with the TypeScript compiler into a temp dir with {"type":"module"}, then runs the function in a separate `node` process (no Vite) and expects 401 for /api/auth/refresh without a session; it also statically checks that every relative import in api/ and server/ ends with .js.

Please check: (1) is this the correct root cause and a sufficient fix for Vercel's Node runtime (consider how @vercel/node traces and compiles server/authHandler.ts, the bracketed filename, whether `api/auth/[action].ts` with named POST/GET exports is handled, and whether vercel.json rewrites or "framework": "vite" could interfere)? (2) any other file that the function imports at runtime that could still fail (transitive imports, node: builtins, type-only imports)? (3) does the regression test really reproduce the production failure (would it fail without the fix?) and is it robust on Windows and Linux CI (temp dir, process.execPath, bracketed path, file URL)? (4) is OAuth PKCE, token security and publishing logic unchanged? (5) does local dev (vite config importing server/devMiddleware.ts) still work? Give findings with ID, severity, file:line, reproduction and fix; skip style nits. End with a verdict: APPROVED or NOT APPROVED.
```

</details>
