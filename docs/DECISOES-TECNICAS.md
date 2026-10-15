# Decisões técnicas

Registro das decisões do publicador. Contexto de produto: o app **não faz curadoria**; a conversa e a escolha das músicas
acontecem no ChatGPT. O app só importa o JSON aprovado, encontra as faixas no Spotify, deixa o usuário conferir e publica.

## 2026-10-14 · MVP

1. **App web estático (Vite + React + TypeScript), sem backend.** O fluxo Authorization Code + PKCE do Spotify não usa
   client secret, então não há segredo para guardar em servidor. Roda local em `http://127.0.0.1:5173`.
   O protótipo Python/HTML anterior foi descartado e nada dele foi reaproveitado.
2. **Redirect URI em `127.0.0.1`, não `localhost`.** O Spotify exige loopback explícito; o Vite está fixado em
   `127.0.0.1:5173` (`strictPort`) para o endereço nunca mudar.
3. **Escopos mínimos:** `playlist-modify-private` e `playlist-modify-public`. Nada de biblioteca, histórico ou e-mail.
4. **Tokens no `sessionStorage`** (somem ao fechar a aba). O Client ID e os "jobs" de publicação ficam no
   `localStorage`. Nenhum token vai para logs, arquivos ou o JSON.
5. **API do Spotify pós-migração de fevereiro de 2026 (Development Mode):** `POST /me/playlists` para criar,
   `POST /playlists/{id}/items` para adicionar (lotes de até 100, com `position`), `GET /playlists/{id}/items` para
   conferir, busca com `limit` ≤ 10 e `GET /tracks/{id}` para validar URIs (o lote `GET /tracks` foi removido).
6. **Correspondência conservadora.** "Encontrada" só quando o título é igual descontando apenas créditos de
   participação (feat./ft./featuring; entre parênteses também part./participação), todos os artistas pedidos aparecem,
   não há marcação de versão divergente (remix, ao vivo, acústica, sped up…) e todas as candidatas exatas são a mesma
   gravação (duração ±3 s e mesma flag explicit). Qualquer outra situação exige escolha manual; o usuário também pode
   pular a faixa de forma explícita. Um URI do JSON que não bate com título, versão ou artistas também pede confirmação.
7. **Publicação idempotente e retomável.** Antes de cada gravação, um job (hash do plano: nome, descrição,
   privacidade e URIs em ordem) é salvo. Reenviar o mesmo plano: se já foi concluído, mostra o link sem recriar; se
   falhou no meio, confere a playlist real e adiciona só o que falta. Se a criação ficou sem resposta, o app pede para
   conferir o Spotify antes de criar de novo. Depois da primeira tentativa, o plano fica travado para edição.
   POSTs não são repetidos automaticamente após 5xx/queda de rede; 429 respeita `Retry-After`; 401 renova o token uma vez.
   Os jobs são separados por conta (`account_id` de `GET /me`) e cada job roda uma execução por vez (fila na aba e
   Web Locks entre abas), para que clique duplo ou duas abas não dupliquem nada.
8. **Verificação final pela API:** a publicação só é dada como concluída quando `GET /playlists/{id}/items` devolve
   exatamente as faixas planejadas, na ordem.
9. **Repetições do JSON são mantidas** (com aviso na conferência); o usuário pode pular uma delas.
10. **Dados do Spotify não vão para modelos de IA.** O app não chama nenhuma IA.
