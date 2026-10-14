# Meu Universo Musical — Publicador Spotify

Aplicativo local que recebe o JSON de uma playlist **já aprovada em conversa no ChatGPT**, encontra as faixas no
catálogo do Spotify, deixa você conferir cada correspondência e só então publica a playlist na sua conta, pela API
oficial.

O app **não faz curadoria** e não usa IA. A conversa e a escolha das músicas continuam no ChatGPT.

```
ChatGPT (aprovação) → JSON → importar no app → conectar Spotify (OAuth PKCE) → conferir faixas
→ prévia (nome, descrição, privacidade, ordem) → clique em Publicar → link real da playlist
```

## Requisitos

- Node.js 20 ou mais novo.
- Conta Spotify **Premium** (exigência do Spotify para apps em Development Mode).
- Um app no [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).

## 1. Criar o app no Spotify (uma vez)

1. Entre no Developer Dashboard e clique em **Create app**.
2. Nome e descrição livres. Em **Redirect URIs**, adicione exatamente:
   `http://127.0.0.1:5173/callback` (use `127.0.0.1`; o Spotify não aceita `localhost`).
3. Em **Which API/SDKs are you planning to use?**, marque **Web API**. Salve.
4. Em **User Management**, confirme que o e-mail da sua conta Spotify está na lista (em Development Mode só contas
   listadas podem usar o app).
5. Copie o **Client ID**. **Não** copie nem use o Client Secret: este app usa PKCE e não precisa dele.

## 2. Rodar o app

```bash
git clone https://github.com/ericrc77/playlist-creator.git
cd playlist-creator
git checkout claude/mvp-publicador-spotify-ks63le   # enquanto não houver merge na branch principal
npm install
npm run dev
```

Abra **http://127.0.0.1:5173** (não `localhost`). Na primeira vez, cole o Client ID na tela e clique em **Salvar**.
Opcional: crie `.env.local` a partir de `.env.example` com `VITE_SPOTIFY_CLIENT_ID=...`.

## 3. Testar a criação de uma playlist real

1. Clique em **Conectar ao Spotify** e autorize. As permissões pedidas são só criar/editar playlists.
2. Cole o JSON aprovado no ChatGPT (ou carregue `examples/playlist-exemplo.json`, que é só um exemplo técnico) e
   clique em **Validar e buscar faixas**.
3. Na conferência, cada faixa aparece como **Encontrada**, **Precisa de confirmação** ou **Não encontrada**. Escolha a
   versão certa (use "ouvir" para conferir), faça uma busca manual ou marque **Pular esta faixa**. O botão de avançar só
   libera quando todas as faixas tiverem uma decisão.
4. Na prévia, revise nome, descrição, privacidade (privada por padrão) e ordem.
5. Clique em **Publicar no Spotify**. Ao final o app mostra o link da playlist, conferido pela API, e as faixas puladas.
6. Abra o link e confira no Spotify.

Se algo falhar no meio (internet, limite de requisições), clique em **Publicar** de novo: o app retoma de onde parou,
sem criar outra playlist nem repetir faixas.

### Problemas comuns

| Sintoma | Causa provável |
|--------|----------------|
| `INVALID_CLIENT: Invalid redirect URI` | O Redirect URI no Dashboard não é exatamente `http://127.0.0.1:5173/callback`. |
| Erro 403 ao buscar ou publicar | Sua conta não está em **User Management**, ou o dono do app está sem Premium. |
| "Permissões faltando" | Desconecte e conecte de novo para aceitar os escopos. |
| Trocar o Client ID | Limpe os dados do site `127.0.0.1:5173` no navegador. |

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
- `src/lib/auth.ts`: OAuth Authorization Code + PKCE.
- `src/lib/spotify.ts`: cliente da Web API (endpoints de 2026, tratamento de 401/403/429/5xx).
- `src/lib/matching.ts` e `resolver.ts`: busca e classificação das correspondências.
- `src/lib/publish.ts`: publicação idempotente e retomável.
- `src/App.tsx`: interface.

Decisões em [docs/DECISOES-TECNICAS.md](docs/DECISOES-TECNICAS.md); plano e estado em
[docs/PLANO-MVP.md](docs/PLANO-MVP.md); revisão pelo Codex em [docs/REVISAO-CODEX.md](docs/REVISAO-CODEX.md).

## Segurança

- Nenhum segredo no repositório: o Client ID não é segredo e o Client Secret não é usado.
- Tokens ficam só no `sessionStorage` da aba e somem ao fechá-la.
- O JSON é recusado se contiver campos de credencial.
