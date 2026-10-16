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

### 2026-10-16 · Revisão de segurança, autenticação e publicação (login persistente)

**Como rodou:** Claude Code no computador do usuário (`C:\dev\playlist-creator`), chamando o Codex CLI 0.157.1 com
`codex exec --sandbox read-only` em três rodadas: revisão adversarial de dc68418..7bb48bb (cookie cifrado, CSRF,
`redirect_uri`, rotação do refresh token, função da Vercel, StrictMode, fluxo colar→conferir→publicar, visibilidade,
`vercel.json`), verificação das correções e segunda verificação. O Codex não alterou arquivos. Cada correção tem teste
de regressão que falha sem ela e passa com ela (conferido desfazendo a correção e rodando o teste).

Texto original: [revisão](codex/revisao-4.md), [verificação](codex/revisao-5.md) e
[segunda verificação](codex/revisao-6.md).

**Linha de base (antes, 7bb48bb):** `npm install` ok · `npm run typecheck` ok · `npm test` 106/106 · `npm run build` ok.
**Depois:** typecheck ok · `npm test` 129/129 (8 arquivos) · build ok.

| ID | Sev. | Achado do Codex | Veredito | Correção |
|----|------|-----------------|----------|----------|
| APP-1 | alta | Busca manual que voltava depois de tocar em Publicar desfazia a escolha; uma nova tentativa podia publicar outra faixa e criar segunda playlist. | Procede | Plano congelado na primeira tentativa e reutilizado nas seguintes; escolha explícita ou publicação invalidam buscas em voo; conferência desabilitada após a tentativa. |
| PUB-1 | média | Visibilidade não confirmada era mostrada como fato e nunca mais conferida. | Procede | Resultado salvo no job; `unknown`/`mismatch` reconferidos ao publicar de novo; a tela diz "visibilidade não confirmada" e oferece "Conferir visibilidade de novo". |
| AUTH-1 | média | Duas abas renovando juntas: a rotação do refresh token fazia uma apagar o cookie novo da outra. | Procede | Renovação e saída sob Web Lock compartilhado entre abas. |
| AUTH-2 | média | "Sair" sem internet parecia funcionar, e o login voltava ao recarregar; logout dependia da configuração do servidor. | Procede | Saída só com confirmação do servidor (senão avisa e continua conectado); logout independe de Client ID/SESSION_SECRET. |
| AUTH-3 | média | Qualquer 400/401 do Spotify (ex.: `invalid_client` por configuração errada) apagava a sessão. | Procede | Só `invalid_grant` encerra a sessão; o resto vira 502 e mantém o cookie. |
| AUTH-4 | baixa | Validade do cookie só no navegador: cópia antiga servia para sempre. | Procede | `exp` (renovado a cada uso, 180 dias) dentro do cookie cifrado e conferido no servidor. Cookies sem `exp` são recusados: quem já estava conectado entra de novo uma vez. |
| NEW-AUTH-1 | média | (verificação) Renovação presa segurava a trava e o logout para sempre. | Procede | Toda chamada a `/api/auth/*` tem prazo de 15 s. |
| NEW-AUTH-2 | média | (verificação) Sem Web Locks, renovação atrasada regravava o cookie depois do logout. | Procede | Fila local serializa renovação e saída na mesma aba. Entre abas, sem Web Locks, o risco continua; o Codex o considerou aceitável para um app pessoal (todos os navegadores atuais têm Web Locks). |
| NEW-AUTH-3 | média | (verificação) Logout respondia "ok" por HTTP fora do loopback sem conseguir apagar o cookie `Secure`. | Procede | Checagem de HTTPS antes do logout. |
| NEW-APP-1 | média | (verificação) Depois de cancelar e colar outra playlist, a busca atrasada da anterior podia invadir a nova. | Procede | Números de busca de um contador que nunca zera. |
| NEW-PUB-1 | média | (verificação) "Conferir visibilidade de novo" não fazia nada em jobs antigos sem o campo. | Procede | O botão pede `retryVisibility`, que também confere jobs antigos; sem o pedido eles ficam intocados. |
| NEW-AUTH-4 | média | (segunda verificação) Se o navegador abortasse a renovação (15 s) e o Spotify rotacionasse o token depois, o cookie novo se perdia. | Procede | O servidor desiste do Spotify em 8 s (menor que os 15 s do navegador) e responde 502 mantendo o cookie. Rotação seguida de queda de rede continua possível, como em qualquer perda de resposta. |

**Áreas que o Codex considerou corretas:** AES-GCM com IV aleatório de 96 bits e tag autenticada; cookie `__Host-`,
`Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/` em produção; CSRF por POST + `X-MUM` + Origin exata (`Origin: null`
recusado); `redirect_uri` derivado do servidor; PKCE com state/verifier validados e apagados; troca do `code` uma única
vez no StrictMode; tokens fora de `localStorage`/`sessionStorage`; faixas ambíguas só publicadas após escolha;
função da Vercel com `Request`/`Response` padrão; rewrite que preserva `/api/*` e `/callback`; CSP.

**Pendências:**
- A última correção (NEW-AUTH-4) não passou por nova rodada do Codex.
- Testado no navegador real: login com o Spotify em `http://127.0.0.1:5173` (antes destas correções).

### 2026-10-16 · Textos da tela de resultado (após o teste real com o Spotify)

**Contexto:** no primeiro teste real, o Spotify manteve pública uma playlist pedida fora do perfil, e ignorou também a
correção. O app detectou e avisou corretamente (`mismatch`), mas dois textos estavam ruins: a linha de resumo dizia
"visibilidade não confirmada" (o valor errado tinha sido confirmado) e, depois de "Conferir visibilidade de novo", o
título virava "Essa playlist já estava publicada". Pedido do usuário: corrigir os dois textos sem mudar a lógica de
publicação, com a frase "O Spotify manteve a playlist pública, apesar da solicitação de privacidade." e sem afirmar que
a playlist aparece no perfil.

Texto original do Codex: [revisão](codex/revisao-7.md), [verificação](codex/revisao-8.md) e [verificação final](codex/revisao-9.md).

**Resultado:** typecheck ok · `npm test` 139/139 · build ok. `src/lib` não foi alterado.

| ID | Sev. | Achado do Codex | Veredito | Correção |
|----|------|-----------------|----------|----------|
| VIS-1 | alta | Estados confirmados ainda diziam "no/fora do seu perfil", mas a API só confirma o campo `public`. | Procede | A tela de resultado diz "pública"/"não pública". |
| STATE-1 | média | Uma segunda conferência que falhasse deixava o aviso de sucesso anterior. | Procede | O aviso é limpo a cada conferência e só aparece quando o Spotify respondeu. |
| STATE-2 | média | A reconferência passava por `publish()`; se o job salvo tivesse sumido, ela podia criar outra playlist. | Procede | O botão chama só `ensureVisibility` (ler e corrigir `public`): não cria playlist nem adiciona faixas. |
| STATE-3 | média | (verificação) Tocar em "Nova playlist" durante uma conferência deixava o estado dela vazar para a próxima. | Procede | "Nova playlist" fica desabilitada durante a conferência, e respostas de uma playlist anterior são ignoradas. |
| VIS-2 | média | (verificação) A opção do formulário ainda diz "Aparece no seu perfil" / "Qualquer pessoa pode encontrar a playlist no seu perfil". | Procede | A pedido do usuário: grupo "Visibilidade solicitada ao Spotify" com "Playlist não pública" (padrão, mesmo se o JSON pedir pública) e "Playlist pública", e a explicação "O Spotify pode ignorar essa configuração. Para restringir o acesso pelo link, use Tornar privada no aplicativo do Spotify." Verificação final do Codex: [aprovado](codex/revisao-9.md), sem achados. |

**Decisão aceita pelo Codex:** como o botão não passa mais por `publish()`, o campo de visibilidade salvo no job não é
atualizado por ele. Uma nova publicação do mesmo plano ainda reconfere `unknown`/`mismatch`. A opção `retryVisibility`
de `src/lib/publish.ts` deixou de ser usada pela tela, mas foi mantida para não alterar `src/lib`.

### 2026-10-16 · Erro 500 na Vercel (`ERR_MODULE_NOT_FOUND`)

**Sintoma:** em https://playlist-creator-ruby.vercel.app o site carregava, mas `/api/auth/refresh` e `/api/auth/exchange`
falhavam com 500 e `Cannot find module '/var/task/server...'`.

**Causa:** `api/auth/[action].ts` importava `../../server/authHandler` sem extensão. A Vercel compila cada `.ts` para
`.js` sem empacotar, e o Node roda o resultado como ESM (`"type": "module"`), que exige extensão explícita em imports
relativos. O Vite e o Vitest resolvem sem extensão, por isso os testes e o `npm run dev` não pegavam o problema.

**Correção:** `.js` nos imports relativos de `api/auth/[action].ts` e `server/devMiddleware.ts` (o TypeScript, com
`moduleResolution: bundler`, e o Vite mapeiam `.js` para o `.ts`). OAuth PKCE, cookie cifrado e publicação não mudaram.

**Teste de regressão:** `tests/vercelFunction.test.ts` transpila `api/` e `server/` como a Vercel, roda a função num
processo `node` separado (sem Vite) e exige 401 em `/api/auth/refresh` sem sessão; antes da correção, falhava com o
mesmo `ERR_MODULE_NOT_FOUND` de produção. Também confere que todo import relativo em `api/` e `server/` termina em `.js`.

**Codex:** [aprovado](codex/revisao-10.md). O único achado (TEST-1, baixa: a checagem estática não via aspas duplas,
re-exports nem `import()`) foi corrigido. **Resultado:** typecheck ok · `npm test` 141/141 · build ok.
