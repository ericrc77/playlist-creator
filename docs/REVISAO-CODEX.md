# Revisão pelo Codex

O Codex está integrado ao Claude Code **no computador do usuário**. As threads na nuvem não têm acesso a ele, então a
revisão roda localmente:

1. No computador, abra o Claude Code na pasta do repositório (`playlist-creator`, branch
   `claude/mvp-publicador-spotify-ks63le`).
2. Peça ao Claude Code:

> Use o Codex como subagente para revisar este repositório. Peça ao Codex: (1) revisão de código focada em segurança do
> OAuth PKCE, armazenamento de tokens e tratamento de erros da API do Spotify; (2) auditoria da lógica de correspondência
> em `src/lib/matching.ts` (casos em que uma versão duvidosa seria escolhida em silêncio); (3) auditoria da
> idempotência em `src/lib/publish.ts` (cenários que criariam playlist duplicada ou faixas repetidas); (4) rodar
> `npm ci && npm run typecheck && npm test`; (5) sugestões de testes faltando. Traga os achados do Codex, decida quais
> corrigir, corrija com testes e registre o resultado aqui.

## Resultados

_Ainda não executado._
