# Plano do MVP — Publicador Spotify

Estado em 2026-10-14. ✅ = implementado e coberto por testes automatizados; ⏳ = depende de teste real.

| # | Tarefa | Estado |
|---|--------|--------|
| 1 | Estrutura do projeto (Vite + React + TS, Vitest, CI no GitHub Actions) | ✅ |
| 2 | Validação do contrato 1.0 com erros em português (`src/lib/contract.ts`) | ✅ |
| 3 | Login Spotify com Authorization Code + PKCE e `state` anti-CSRF (`src/lib/auth.ts`) | ✅ (⏳ login real) |
| 4 | Cliente da Web API com endpoints de 2026, 401/403/429/5xx (`src/lib/spotify.ts`) | ✅ (⏳ API real) |
| 5 | Busca por título + artista e classificação conservadora (`src/lib/matching.ts`, `resolver.ts`) | ✅ |
| 6 | Tela de conferência: escolher versão, busca manual, pular faixa | ✅ |
| 7 | Prévia final: nome, descrição, privacidade (privada por padrão) e ordem | ✅ |
| 8 | Publicação idempotente/retomável com verificação final (`src/lib/publish.ts`) | ✅ (⏳ API real) |
| 9 | Resultado com link real e resumo de faixas adicionadas/puladas | ✅ |
| 10 | Revisão, testes e auditoria pelo Codex | ⏳ aguardando execução local (o Codex não está disponível na nuvem) |
| 11 | Primeira playlist real criada pelo usuário | ⏳ |

## Rodada 2026-10-16 · publicação rápida

| Item | Estado |
|---|---|
| Config para Vercel (`vercel.json`, funções `api/auth`) | ✅ (deploy aguarda confirmação do Eric) |
| Client ID no ambiente | ✅ |
| Login persistente com renovação (cookie HttpOnly cifrado) | ✅ |
| Colar → conferir dúvidas → publicar numa tela | ✅ |
| Privacidade conferida e corrigida após publicar | ✅ |
| Interface para celular | ✅ |
| Revisão do Codex desta rodada | ⏳ |

## Fora do MVP
Curadoria/IA no app, sincronização automática com o ChatGPT, cópia de curtidas para o Notion, deploy obrigatório.
