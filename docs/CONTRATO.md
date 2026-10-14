# Meu Universo Musical — contrato ChatGPT → aplicativo

**Versão proposta: `1.0`**. Esta fonte informa ao ChatGPT como entregar uma playlist **depois da aprovação do usuário**. O Claude Code deve implementar validação desse contrato; se mudar o schema, atualizar esta fonte e a documentação do repositório.

## Regra essencial

O aplicativo é apenas o **publicador**. A conversa, as pesquisas, as sugestões e os ajustes acontecem no ChatGPT. **Não gerar arquivo final antes da aprovação.** O usuário copia o JSON ou baixa um `.json` e importa no aplicativo.

## Formato JSON

```json
{
  "schema_version": "1.0",
  "playlist": {
    "name": "Passando roupa — Meu momento",
    "description": "Seleção aprovada em conversa no ChatGPT.",
    "public": false
  },
  "tracks": [
    {
      "title": "Mitsubishi",
      "artists": ["Orochi", "Kizzy"]
    },
    {
      "title": "Paypal",
      "artists": ["Teto"]
    },
    {
      "title": "Blindado por Deus",
      "artists": ["MC Cabelinho"]
    }
  ]
}
```

**Este JSON é somente um exemplo técnico baseado em títulos visíveis numa fila compartilhada. Não é uma playlist aprovada nem um registro de gosto.**

## Campos

- `schema_version`: obrigatório, string. MVP aceita `1.0`.
- `playlist.name`: obrigatório, não vazio.
- `playlist.description`: opcional, texto.
- `playlist.public`: booleano, padrão e recomendação `false`.
- `tracks`: lista não vazia **ordenada**; ordem representa a ordem final solicitada.
- `tracks[].title`: nome da faixa; obrigatório quando não houver Spotify URI.
- `tracks[].artists`: lista de nomes dos artistas conforme curadoria; obrigatório para correspondência por nome.
- `tracks[].spotify_uri`: opcional, por exemplo `spotify:track:<id>`; se fornecido, validar na API antes de adicionar. O aplicativo pode aceitar `spotify_url` e converter para URI.

## Tratamento obrigatório no aplicativo

1. Validar JSON e schema antes de fazer chamadas de gravação.
2. Para cada faixa, pesquisar catálogo pelo título e artistas, não usar correspondência por título apenas.
3. Dar prioridade a coincidências exatas, mas permitir seleção manual para remix, ao vivo, vídeo, acústica, versões explicit/clean ou faixas com artistas homônimos.
4. Nunca escolher silenciosamente uma versão duvidosa. Mostrar 'Não encontrada' ou 'Precisa de confirmação'.
5. Preservar a ordem do JSON e não remover repetições intencionais sem perguntar.
6. Apresentar prévia completa de título, artista, versão, número de faixas e privacidade antes de criar.
7. Fazer publicação somente após clique explícito do usuário.
8. Confirmar sucesso pela API e mostrar link real do Spotify; evitar playlist vazia ou duplicações acidentais na falha/reenvio.
9. Tratar autorização expirada, falta de escopo, 403, 429, resultados ausentes e falhas parciais, exibindo estado verificável e opções de retomada.
10. Não expor tokens, segredos ou dados sensíveis no JSON, logs, GitHub nem nos prompts.

## Restrições de uso dos dados

- O ChatGPT não deve enviar ao aplicativo credenciais, análises de perfil ou bibliotecas privadas do Spotify.
- O aplicativo usa os dados de busca/metadata da API apenas para **resolver as faixas e montar a playlist**; não deve enviar dados Spotify a modelos de IA.
- Nada é inserido automaticamente no 'Repertório aprovado' do Notion por ter sido exportado ou publicado.

## Documentação Spotify

- Authorization Code + PKCE: https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow
- Criar playlist: https://developer.spotify.com/documentation/web-api/reference/create-playlist
- Adicionar faixas: https://developer.spotify.com/documentation/web-api/reference/add-items-to-playlist
- Buscar faixas: https://developer.spotify.com/documentation/web-api/reference/search
- Orientações oficiais para construção com IA: https://developer.spotify.com/documentation/web-api/tutorials/building-with-ai
- Mudanças Dev Mode 2026: https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide

> Atenção: o Spotify exige conta Premium do proprietário do app no modo de desenvolvimento. A API evolui; Claude Code deve consultar documentação atualizada e nunca deduzir endpoints de exemplos antigos.
