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

### 2026-10-14 · Revisão local com Codex

**Como rodou:** Claude Code no computador do usuário (`C:\dev\playlist-creator`), chamando o Codex CLI 0.157.1 com
`codex exec --sandbox read-only` em três rodadas: revisão completa, re-verificação das correções e checagem final. O
Codex não alterou arquivos. As correções foram feitas pelo Claude Code, cada uma com teste de regressão (os testes
novos falham sem a correção e passam com ela).

Texto original das três rodadas: [revisão completa](codex/revisao-1.md), [re-verificação](codex/revisao-2.md) e
[checagem final](codex/revisao-3.md).

**Linha de base (antes):** `npm ci` ok · `npm run typecheck` ok · `npm test` 66/66 · `npm run build` ok.
**Depois:** typecheck ok · `npm test` 79/79 (7 arquivos) · build ok.

| ID | Sev. | Achado do Codex | Veredito | Correção |
|----|------|-----------------|----------|----------|
| F1 | média | Duas publicações simultâneas (clique duplo, duas abas) podiam criar duas playlists ou repetir lotes. | Procede | Execução serializada por job (fila na aba + Web Locks entre abas), job relido dentro da trava; botão "Conferi: criar a playlist" desabilitado durante a publicação. |
| F2 | média | URI do JSON apontando para outra versão (ex.: "Ao Vivo") era aceito em silêncio quando o título base batia. | Procede | URI só é "Encontrada" se título estrito e versão também batem. |
| F3 | média | Complementos desconhecidos ("(Unplugged)", "- Alternate Take") eram apagados pelo título base e a faixa podia ser escolhida em silêncio. | Procede | Escolha automática exige título estrito (descontando só créditos de participação); novos marcadores de versão. Na re-verificação o Codex apontou que "(with …)" e "Part. II" ainda eram tratados como crédito; também corrigido. |
| F4 | média | Jobs de publicação compartilhados entre contas do Spotify no mesmo navegador. | Procede | Jobs separados por conta via `GET /me`, usando `account_id` (estável), como recomendou o Codex na re-verificação. |
| F5 | baixa | Retorno `/callback?error=...` era tratado antes de validar o `state`. | Procede | `state`/verifier validados antes de qualquer tratamento. |
| F6 | baixa | Resposta de token sem `scope` virava "nenhum escopo" e o app acusava permissões faltando. | Procede | Mantém os escopos pedidos (login) ou anteriores (renovação). |
| F7 | baixa | Hash FNV-1a de 32 bits do plano poderia colidir. | Rejeitado | A chave também tem o número de faixas e a conta; com poucos planos por usuário a chance é desprezível. O Codex concordou. |
| R1 | — | (re-verificação) `GET /me` exigiria `user-read-private`. | Rejeitado | A referência do Spotify liga esses escopos só aos campos `country`/`email`/`product`; `id`/`account_id` não precisam. O Codex aceitou. |
| R2 | — | (checagem final) jobs antigos gravados sob `id` ficariam órfãos ao trocar para `account_id`. | Rejeitado | A chave por `id` só existiu num commit desta mesma revisão, nunca usado; o app ainda não publicou nada real. |

**Áreas que o Codex considerou corretas:** geração do verifier/state (aleatoriedade sem viés), uso único e limpeza do
verifier, tokens só no `sessionStorage` e fora de logs, remoção do `code` do histórico, renovação de token coalescida e
401 renovado uma vez, 403/429 (`Retry-After`), POSTs não repetidos após 5xx/queda de rede, retomada conferindo o estado
real e verificação final da ordem, endpoints de fevereiro de 2026.

**Pendências:**
- Confirmar no teste real com o Spotify que `GET /me` responde com os escopos atuais e traz `account_id`.
- `npm audit`: 0 vulnerabilidades no que vai para o app (`--omit=dev`). Nas dependências de teste há 3 (vitest,
  @vitest/mocker, tinypool; 2 críticas, 1 moderada) que só afetam a máquina de quem roda os testes. A correção exige
  migrar para vitest 5 (mudança incompatível); fica para um PR separado.
- Web Locks depende do navegador; sem suporte, a proteção vale só dentro da mesma aba.
