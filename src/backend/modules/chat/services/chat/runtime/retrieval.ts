import { createEmbedding } from 'giga-ai-helper/embeddings';
import { cosineSimilarity, lexicalScore, parseEmbeddingValue, toNumber } from 'giga-ai-helper';
import { RetrievedChunk, RetrievalInput, RetrievalOutput } from '@giga/shared/types/contracts/graphql.types';
import { getScopedLogger, toErrorMeta } from '@connectingmatrix/logger/lib/logger';
import { ChunkEntity } from '@connectingmatrix/orm/repositories/entities';

const DEFAULT_TOP_K = 8;
const DEFAULT_FALLBACK_CANDIDATE_LIMIT = 250;

function normalizeChunkRow(row: any, rank: number): RetrievedChunk | null {
  const chunkId = toNumber(row.chunk_id ?? row.id);
  if (!chunkId) return null;

  return {
    chunk_id: chunkId,
    subject_id: row.subject_id || null,
    post_id: row.post_id || null,
    attachment_id: row.attachment_id || null,
    source_kind: row.source_kind === 'attachment' ? 'attachment' : 'post',
    chunk_index: toNumber(row.chunk_index) || 0,
    content: String(row.content || row.chunk || row.text || ''),
    token_count: toNumber(row.token_count),
    metadata: row.metadata || null,
    similarity: toNumber(row.similarity ?? row.score ?? row.match_score),
    rank,
  };
}

export function filterChunkRowsForRetrieval(rows: any[], subjectIds?: string[] | null, postIds?: string[] | null) {
  const normalizedSubjectIds = subjectIds && subjectIds.length ? new Set(subjectIds) : null;
  const normalizedPostIds = postIds && postIds.length ? new Set(postIds) : null;
  return rows.filter((row) => {
    if (normalizedSubjectIds && !normalizedSubjectIds.has(row.subject_id)) {
      return false;
    }

    if (normalizedPostIds && !normalizedPostIds.has(row.post_id)) {
      return false;
    }

    return true;
  });
}

export function rankFallbackChunkRows(rows: any[], queryEmbedding: number[], question: string, topK: number): RetrievedChunk[] {
  const rankedRows = rows
    .map((row) => {
      const rowEmbedding = parseEmbeddingValue(row.embedding);
      const cosine = rowEmbedding ? cosineSimilarity(queryEmbedding, rowEmbedding) : null;
      const lexical = lexicalScore(question, String(row.content || ''));
      const score = cosine !== null ? cosine : lexical;
      return {
        row,
        score,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return rankedRows
    .map(({ row, score }, index) => {
      const normalized = normalizeChunkRow(row, index + 1);
      if (!normalized) return null;
      return {
        ...normalized,
        similarity: normalized.similarity !== null && normalized.similarity !== undefined ? normalized.similarity : score,
      };
    })
    .filter(Boolean) as RetrievedChunk[];
}

const logger = getScopedLogger('agent-retrieval-service');

async function tryRpcRetrieval({
  supabase,
  subjectIds,
  postIds,
  topK,
  queryEmbedding,
}: {
  supabase: any;
  subjectIds: string[] | null;
  postIds: string[] | null;
  topK: number;
  queryEmbedding: number[];
}): Promise<RetrievedChunk[] | null> {
  const rpcAttemptMeta = {
    rpc_name: 'retrieve_ai_chunks',
    top_k: topK,
    subject_ids_count: subjectIds?.length || 0,
    post_ids_count: postIds?.length || 0,
  };
  logger.debug('agent.retrieval.rpc.attempt', rpcAttemptMeta);
  try {
    const data = await ChunkEntity.retrieveByEmbedding({ queryEmbedding, topK, subjectIds, postIds });
    const normalized = data.map((row, index) => normalizeChunkRow(row, index + 1)).filter(Boolean) as RetrievedChunk[];
    const filtered = filterChunkRowsForRetrieval(normalized, subjectIds, postIds);
    logger.info('agent.retrieval.rpc.succeeded', { rpc_name: 'retrieve_ai_chunks', chunks: filtered.length });
    return filtered.slice(0, topK);
  } catch (error: any) {
    const rpcFailedMeta = {
      rpc_name: 'retrieve_ai_chunks',
      error_code: error?.code || null,
      error_message: error?.message || null,
    };
    logger.debug('agent.retrieval.rpc.failed', rpcFailedMeta);
    logger.warn('agent.retrieval.rpc.unavailable');
    return null;
  }
}

async function fallbackRetrieval({
  supabase,
  question,
  queryEmbedding,
  subjectIds,
  postIds,
  topK,
}: {
  supabase: any;
  question: string;
  queryEmbedding: number[];
  subjectIds: string[] | null;
  postIds: string[] | null;
  topK: number;
}): Promise<RetrievedChunk[]> {
  if (subjectIds && !subjectIds.length) return [];
  if (postIds && !postIds.length) return [];

  logger.debug('agent.retrieval.fallback.started', { top_k: topK, subject_ids_count: subjectIds?.length || 0, post_ids_count: postIds?.length || 0 });
  const rows = await ChunkEntity.listFallbackCandidates({
    limit: Math.max(DEFAULT_FALLBACK_CANDIDATE_LIMIT, topK * 20),
    subjectIds,
    postIds,
  });
  const filteredRows = filterChunkRowsForRetrieval(rows || [], subjectIds, postIds);
  const ranked = rankFallbackChunkRows(filteredRows, queryEmbedding, question, topK);
  logger.info('agent.retrieval.fallback.completed', { candidates: filteredRows.length, chunks: ranked.length });
  return ranked;
}

export async function retrieve(input: RetrievalInput): Promise<RetrievalOutput> {
  const startedAt = Date.now();
  const topK = Math.max(1, input.topK || DEFAULT_TOP_K);
  const question = input.question.trim();
  // prettier-ignore
  logger.info('agent.retrieval.started', { question_chars: question.length, top_k: topK, subject_ids_count: input.subjectIds?.length || 0, post_ids_count: input.postIds?.length || 0, });
  if (!question) {
    logger.warn('agent.retrieval.skipped', { reason: 'empty_question' });
    return {
      chunks: [],
      queryEmbedding: [],
    };
  }

  let queryEmbedding: number[] = [];
  try {
    queryEmbedding = (await createEmbedding(question)).vector;
  } catch (error) {
    logger.error('agent.retrieval.embedding.failed', { error: toErrorMeta(error) });
    throw error;
  }

  if (input.subjectIds && input.subjectIds.length === 0) {
    logger.info('agent.retrieval.completed', { chunks: 0, duration_ms: Date.now() - startedAt, reason: 'subject_filter_empty' });
    return {
      chunks: [],
      queryEmbedding,
    };
  }

  if (input.postIds && input.postIds.length === 0) {
    logger.info('agent.retrieval.completed', { chunks: 0, duration_ms: Date.now() - startedAt, reason: 'post_filter_empty' });
    return {
      chunks: [],
      queryEmbedding,
    };
  }

  const rpcResult = await tryRpcRetrieval({
    supabase: input.supabase,
    subjectIds: input.subjectIds || null,
    postIds: input.postIds || null,
    topK,
    queryEmbedding,
  });

  if (rpcResult) {
    logger.info('agent.retrieval.completed', { chunks: rpcResult.length, via: 'rpc', duration_ms: Date.now() - startedAt });
    return {
      chunks: rpcResult,
      queryEmbedding,
    };
  }

  const fallbackChunks = await fallbackRetrieval({
    supabase: input.supabase,
    question,
    queryEmbedding,
    subjectIds: input.subjectIds || null,
    postIds: input.postIds || null,
    topK,
  });

  logger.info('agent.retrieval.completed', { chunks: fallbackChunks.length, via: 'fallback', duration_ms: Date.now() - startedAt });

  return {
    chunks: fallbackChunks,
    queryEmbedding,
  };
}
