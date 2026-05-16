import { getScopedLogger, toErrorMeta } from '@connectingmatrix/logger/lib/logger';
import { SubjectEntity } from '@connectingmatrix/orm/repositories/entities';
import { retrieve } from '@connectingmatrix/chat/services/chat/runtime/retrieval';
import type { RetrieveInput } from '@giga/shared/types/contracts/chat.types';

const logger = getScopedLogger('agent-service');

export async function retrieveChunks(supabase: any, input: RetrieveInput) {
  const startedAt = Date.now();
  const normalizedPostIds = Array.from(new Set([input.postId, ...(input.postIds || [])].filter(Boolean))) as string[];

  // prettier-ignore
  logger.debug('agent.retrieve.started', { question_chars: input.question?.length || 0, input_subject_ids_count: input.subjectIds?.length || 0, has_subject_id: Boolean(input.subjectId), input_post_ids_count: normalizedPostIds.length, has_tag_slugs: Boolean(input.tagSlugs?.length), has_subject_query: Boolean(input.subjectQuery?.trim()), top_k: input.topK || null, });

  try {
    const resolvedFilter = await SubjectEntity.resolveIds({
      supabase,
      subjectId: input.subjectId,
      subjectIds: input.subjectIds,
      tagSlugs: input.tagSlugs,
      subjectQuery: input.subjectQuery,
    });

    const retrieval = await retrieve({
      supabase,
      question: input.question,
      subjectIds: resolvedFilter.filterApplied ? resolvedFilter.subjectIds || [] : null,
      postIds: normalizedPostIds.length ? normalizedPostIds : null,
      topK: input.topK,
    });

    const response = {
      chunks: retrieval.chunks,
      queryEmbedding: retrieval.queryEmbedding,
      subject_ids: resolvedFilter.subjectIds,
      subject_filter_applied: resolvedFilter.filterApplied,
      post_ids: normalizedPostIds.length ? normalizedPostIds : null,
    };

    // prettier-ignore
    logger.info('agent.retrieve.completed', { chunks: response.chunks.length, subject_filter_applied: response.subject_filter_applied, resolved_subject_ids_count: response.subject_ids?.length || 0, post_ids_count: response.post_ids?.length || 0, duration_ms: Date.now() - startedAt, });

    return response;
  } catch (error) {
    logger.error('agent.retrieve.failed', { duration_ms: Date.now() - startedAt, error: toErrorMeta(error) });
    throw error;
  }
}
