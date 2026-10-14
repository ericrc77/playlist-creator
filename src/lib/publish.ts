// Publicação idempotente e retomável.
//
// Um "job" é salvo no armazenamento local antes de cada etapa de gravação. Se a
// publicação falhar no meio (rede, 429, aba fechada), clicar em "Publicar" de novo
// retoma o mesmo job: confere o que já está na playlist e só adiciona o que falta.
// Isso evita playlists duplicadas e faixas repetidas por acidente.

import type { KVStore } from './auth';
import { ADD_ITEMS_BATCH, SpotifyApiError, type SpotifyClient } from './spotify';

export interface PublishPlan {
  name: string;
  description: string;
  public: boolean;
  /** URIs na ordem final, repetições intencionais incluídas. */
  uris: string[];
}

export interface PublishJob {
  fingerprint: string;
  /** Uma tentativa de criar a playlist foi enviada, mas a resposta não chegou. */
  createAttempted: boolean;
  playlistId?: string;
  playlistUrl?: string;
  addedCount: number;
  done: boolean;
}

export type PublishOutcome =
  | { kind: 'done'; playlistId: string; playlistUrl: string; added: number; alreadyPublished: boolean }
  | { kind: 'uncertain_create'; message: string }
  | { kind: 'diverged'; playlistUrl: string; message: string };

const JOB_PREFIX = 'mum.job.';

/** Hash estável (FNV-1a 32 bits) do plano: mesmo plano → mesmo job. */
export function fingerprint(plan: PublishPlan): string {
  const s = JSON.stringify([plan.name, plan.description, plan.public, plan.uris]);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0') + '-' + plan.uris.length;
}

export function loadJob(store: KVStore, fp: string): PublishJob | null {
  const raw = store.getItem(JOB_PREFIX + fp);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PublishJob;
  } catch {
    return null;
  }
}

function saveJob(store: KVStore, job: PublishJob) {
  store.setItem(JOB_PREFIX + job.fingerprint, JSON.stringify(job));
}

export function forgetJob(store: KVStore, fp: string) {
  store.removeItem(JOB_PREFIX + fp);
}

export interface PublishOptions {
  /** O usuário confirmou que verificou o Spotify e quer criar mesmo após uma tentativa incerta. */
  confirmRecreate?: boolean;
  onProgress?: (added: number, total: number) => void;
}

export async function publish(
  client: SpotifyClient,
  plan: PublishPlan,
  store: KVStore,
  opts: PublishOptions = {},
): Promise<PublishOutcome> {
  if (plan.uris.length === 0) throw new Error('Nenhuma faixa confirmada para publicar.');
  if (!plan.name.trim()) throw new Error('A playlist precisa de um nome.');

  const fp = fingerprint(plan);
  const job: PublishJob = loadJob(store, fp) ?? { fingerprint: fp, createAttempted: false, addedCount: 0, done: false };

  if (job.done && job.playlistId && job.playlistUrl) {
    return { kind: 'done', playlistId: job.playlistId, playlistUrl: job.playlistUrl, added: job.addedCount, alreadyPublished: true };
  }

  if (!job.playlistId) {
    if (job.createAttempted && !opts.confirmRecreate) {
      return {
        kind: 'uncertain_create',
        message: `Uma tentativa anterior de criar "${plan.name}" não recebeu resposta. Abra o Spotify e confira se a playlist já existe antes de criar de novo.`,
      };
    }
    job.createAttempted = true;
    saveJob(store, job);
    let created;
    try {
      created = await client.createPlaylist(plan.name, plan.description, plan.public);
    } catch (e) {
      // Erros 4xx (inclusive 429) garantem que nada foi criado: libera nova tentativa sem aviso.
      if (e instanceof SpotifyApiError && e.status >= 400 && e.status < 500) {
        job.createAttempted = false;
        saveJob(store, job);
      }
      throw e;
    }
    job.playlistId = created.id;
    job.playlistUrl = created.external_urls?.spotify ?? `https://open.spotify.com/playlist/${created.id}`;
    job.addedCount = 0;
    saveJob(store, job);
  } else {
    // Retomada: o estado real da playlist vale mais que o contador salvo.
    const current = await client.getPlaylistItemUris(job.playlistId);
    if (!isPrefix(current, plan.uris)) {
      return {
        kind: 'diverged',
        playlistUrl: job.playlistUrl!,
        message: 'A playlist foi alterada fora do aplicativo desde a última tentativa. Confira no Spotify; nada mais foi adicionado.',
      };
    }
    job.addedCount = current.length;
    saveJob(store, job);
  }

  const playlistId = job.playlistId!;
  opts.onProgress?.(job.addedCount, plan.uris.length);
  while (job.addedCount < plan.uris.length) {
    const batch = plan.uris.slice(job.addedCount, job.addedCount + ADD_ITEMS_BATCH);
    await client.addItems(playlistId, batch, job.addedCount);
    job.addedCount += batch.length;
    saveJob(store, job);
    opts.onProgress?.(job.addedCount, plan.uris.length);
  }

  // Confirmação pela API: a playlist precisa conter exatamente as faixas planejadas, na ordem.
  const final = await client.getPlaylistItemUris(playlistId);
  if (!sameList(final, plan.uris)) {
    return {
      kind: 'diverged',
      playlistUrl: job.playlistUrl!,
      message: `A verificação final encontrou ${final.length} faixa(s) na playlist, mas eram esperadas ${plan.uris.length}. Confira no Spotify.`,
    };
  }
  job.done = true;
  saveJob(store, job);
  return { kind: 'done', playlistId, playlistUrl: job.playlistUrl!, added: final.length, alreadyPublished: false };
}

function isPrefix(actual: string[], expected: string[]): boolean {
  return actual.length <= expected.length && actual.every((u, i) => u === expected[i]);
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((u, i) => u === b[i]);
}
