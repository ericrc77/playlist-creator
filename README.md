# Meu Universo Musical — Publicador Spotify

Aplicativo web que recebe o JSON de uma playlist **já aprovada em conversa no ChatGPT**, encontra as faixas no
catálogo do Spotify, deixa você conferir cada correspondência e só então publica a playlist na sua conta, pela API
oficial.

O app **não faz curadoria** e não usa IA. A conversa e a escolha das músicas continuam no ChatGPT.

```
ChatGPT (aprovação) → copiar o JSON → colar no app → conferir só as faixas com dúvida → Publicar → link
```

Funciona no celular e no computador. Depois de conectar o Spotify uma vez, o app lembra o acesso neste aparelho.

## Requisitos

- Node.js 20 ou mais novo.
- Conta Spotify **Premium** (exigência do Spotify para apps em Development Mode).
- Um app no [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).

## 1. Configurar o app no Spotify (uma vez)

1. No [Developer Dashboard](https://developer.spotify.com/dashboard), abra o app (ou **Create app**, marcando **Web API**).
2. Em **Redirect URIs**, deixe cadastrados exatamente:
   - `http://127.0.0.1:5173/callback` (uso local; o Spotify não aceita `localhost`);
   - `https://SEU-DOMINIO.vercel.app/callback` (o domínio que a Vercel der ao projeto).
3. Em **User Management**, confirme que o e-mail da sua conta Spotify está na lista.
4. Copie o **Client ID**. **Não** use o Client Secret: o login é PKCE e não precisa dele.

## 2. Publicar na Vercel

1. Na Vercel, **Add New → Project** e importe `ericrc77/playlist-creator`. A Vercel detecta Vite; o `vercel.json`
   já define build, rotas e cabeçalhos de segurança.
2. Em **Settings → Environment Variables**, crie (Production e Preview):
   - `VITE_SPOTIFY_CLIENT_ID` = o Client ID do Spotify (não é segredo);
   - `SESSION_SECRET` = um valor aleatório de 64 caracteres, marcado como **Sensitive**. Gere com
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Ele cifra o cookie de sessão; trocar
     o valor desconecta todo mundo.
3. Em **Settings → Git**, a branch de produção pode ser `claude/mvp-publicador-spotify-ks63le` enquanto não houver
   merge na principal.
4. Faça o deploy e cadastre `https://<domínio>/callback` no Spotify (passo 1.2).

## 3. Rodar localmente (opcional)

```bash
npm install
cp .env.example .env.local   # preencha VITE_SPOTIFY_CLIENT_ID (SESSION_SECRET é opcional no dev)
npm run dev
```

Abra **http://127.0.0.1:5173** (não `localhost`). O `npm run dev` já inclui as rotas `/api/auth/*`.

## 4. Publicar uma playlist

1. Toque em **Conectar ao Spotify** e autorize (só na primeira vez em cada aparelho).
2. Toque em **Colar da área de transferência** (ou cole no campo / escolha um arquivo `.json`). O app valida e já
   busca as faixas.
3. Faixas encontradas com segurança não pedem nada. As que têm dúvida aparecem em **Confira antes de publicar**:
   escolha a versão certa (use "ouvir"), faça uma busca manual ou marque **Pular esta faixa**.
4. Confira o nome e a visibilidade solicitada (**Playlist não pública** é o padrão, mesmo que o JSON peça pública) e
   toque em **Publicar N faixas**.
5. O app confirma as faixas pela API, confere a visibilidade que o Spotify de fato aplicou e mostra **Abrir no Spotify**.

Se algo falhar no meio, toque em **Publicar** de novo: o app continua de onde parou, sem duplicar playlist nem faixas.

### Privacidade: o que a API permite

"Playlist não pública" e "Playlist pública" são **pedidos** ao Spotify (campo `public` da API), não garantias de
privacidade. O Spotify pode ignorar essa configuração: no primeiro teste real (2026-10-16) ele manteve pública uma
playlist pedida não pública e ignorou também a correção. Por isso, depois de publicar, o app confere o valor que o
Spotify aplicou, tenta corrigir e avisa quando não consegue. **Quem tiver o link ainda consegue abrir** uma playlist
não pública: a opção "Tornar privada" do app do Spotify não existe na API. Para restringir o acesso pelo link, use
"Tornar privada" no menu da playlist, no app do Spotify.

### Problemas comuns

| Sintoma | Causa provável |
|--------|----------------|
| `INVALID_CLIENT: Invalid redirect URI` | O endereço `/callback` do site aberto não está cadastrado no Dashboard. |
| Erro 403 ao buscar ou publicar | Sua conta não está em **User Management**, ou o dono do app está sem Premium. |
| "SESSION_SECRET não está configurado" | Falta a variável na Vercel (ou tem menos de 32 caracteres). Ajuste e faça redeploy. |
| "VITE_SPOTIFY_CLIENT_ID" na tela | Falta a variável na Vercel; ela entra no build, então faça redeploy depois de criar. |
| Pede login de novo | Você tocou em **Sair**, removeu o acesso no Spotify ou o `SESSION_SECRET` mudou. |

## Formato do JSON (contrato 1.0)

Ver [docs/CONTRATO.md](docs/CONTRATO.md). Resumo:

```json
{
  "schema_version": "1.0",
  "playlist": { "name": "Nome", "description": "Opcional", "public": false },
  "tracks": [
    { "title": "Título", "artists": ["Artista 1", "Artista 2"] },
    { "spotify_url": "https://open.spotify.com/track/..." }
  ]
}
```

## Desenvolvimento

```bash
npm test           # testes automatizados (Vitest)
npm run typecheck  # TypeScript
npm run build      # build de produção
```

- `src/lib/contract.ts`: validação do contrato.
- `src/lib/auth.ts` e `session.ts`: login PKCE no navegador e token de acesso em memória.
- `server/authHandler.ts` (rotas `api/auth/[action].ts`): troca e renovação do token, cookie de sessão cifrado.
- `src/lib/spotify.ts`: cliente da Web API (endpoints de 2026, tratamento de 401/403/429/5xx).
- `src/lib/matching.ts` e `resolver.ts`: busca e classificação das correspondências.
- `src/lib/publish.ts`: publicação idempotente e retomável.
- `src/App.tsx`: interface.

Decisões em [docs/DECISOES-TECNICAS.md](docs/DECISOES-TECNICAS.md); plano e estado em
[docs/PLANO-MVP.md](docs/PLANO-MVP.md); revisão pelo Codex em [docs/REVISAO-CODEX.md](docs/REVISAO-CODEX.md).

## Segurança

- Nenhum segredo no repositório. O Client ID não é segredo, o Client Secret não é usado e o `SESSION_SECRET` vive só
  nas variáveis da Vercel (ou no seu `.env.local`, que o git ignora).
- O refresh token fica num cookie `HttpOnly`, `Secure`, `SameSite=Strict`, cifrado com AES-256-GCM: scripts da página
  não conseguem lê-lo. O access token (1 h) fica só na memória da aba.
- As rotas `/api/auth/*` aceitam só POST da mesma origem com cabeçalho próprio, e o `redirect_uri` é fixado pelo
  servidor. A página usa CSP restrita (`vercel.json`).
- O JSON é recusado se contiver campos de credencial.
