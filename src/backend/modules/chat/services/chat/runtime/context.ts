import { unique, toExcerpt } from 'giga-ai-helper';
import { AgentConversationContext, AgentScope } from '@giga/shared/types/contracts/agent.types';
import { getScopedLogger, toErrorMeta } from '@connectingmatrix/logger/lib/logger';
import { GigaORM } from '@connectingmatrix/orm/orm';
import { ChatMessageEntity, SubjectTagEntity, TagEntity } from '@connectingmatrix/orm/repositories/entities';
import { Subject } from '@connectingmatrix/orm/repositories/entities/tree/Subject';
import { Post } from '@connectingmatrix/orm/repositories/entities/tree/Post';
import { ensureEntityOrmInstalled } from '@connectingmatrix/orm/services/graphql/entity-request-context';
import { loadChatWorkflowState } from '../actions/auth/workflow-session';

const MAX_POSTS_FOR_CONTEXT = 20;
const MAX_NARRATIVE_EXCERPT = 800;
const MAX_CHAT_HISTORY = 25;

function normalizeTagSlugs(values?: string[]) {
  if (!values?.length) return [];
  return unique(values.map((value) => value.toLowerCase()));
}

const logger = getScopedLogger('agent-context-service');

const contextScope = (input: { userId: string }) => ({ id: input.userId, type: 'user' as const });

async function loadSubjectTags(supabase: any, subjectIds: string[]) {
  if (!subjectIds.length) return new Map<string, string[]>();

  const relations = await SubjectTagEntity.findBySubjectIds(subjectIds);
  const tagIds = unique((relations || []).map((row: any) => String(row.tag_id)));

  if (!tagIds.length) {
    return new Map(subjectIds.map((subjectId) => [subjectId, []]));
  }

  const tags = await TagEntity.findByIds(tagIds.map((id) => Number(id)));

  const slugByTagId = new Map<string, string>();
  for (const tag of tags || []) {
    if (tag?.id === null || tag?.id === undefined) continue;
    const slug = String(tag.slug || '')
      .trim()
      .toLowerCase();
    if (!slug) continue;
    slugByTagId.set(String(tag.id), slug);
  }

  const grouped = new Map<string, string[]>();
  for (const relation of relations || []) {
    const subjectId = String(relation.subject_id || '').trim();
    const slug = slugByTagId.get(String(relation.tag_id));
    if (!subjectId || !slug) continue;
    const list = grouped.get(subjectId) || [];
    if (!list.includes(slug)) list.push(slug);
    grouped.set(subjectId, list);
  }

  for (const subjectId of subjectIds) {
    if (!grouped.has(subjectId)) grouped.set(subjectId, []);
  }

  return grouped;
}

export async function buildAgentContext(input: {
  supabase: any;
  userId: string;
  chatId: string;
  scopeType?: 'channel' | 'category' | 'subject' | 'post' | 'temporary' | null;
  scopeId?: string | null;
  subjectIds?: string[];
  postIds?: string[];
  tagSlugs?: string[];
}): Promise<AgentConversationContext> {
  const startedAt = Date.now();
  const scope: AgentScope = {
    scope_type: input.scopeType || null,
    scope_id: input.scopeId || null,
    subject_ids: unique(input.subjectIds || []),
    post_ids: unique(input.postIds || []),
    tag_slugs: normalizeTagSlugs(input.tagSlugs),
  };

  // prettier-ignore
  logger.debug('agent.context.started', { chat_id: input.chatId, user_id: input.userId, subject_ids_count: scope.subject_ids.length, post_ids_count: scope.post_ids.length, tag_slugs_count: scope.tag_slugs.length, });

  try {
    await ensureEntityOrmInstalled();
    const context = await GigaORM.run(
      {
        caller: { id: input.userId, type: 'user' },
        scope: contextScope(input),
        meta: { supabase: input.supabase },
      },
      async () => {
        const subjectQuery = scope.subject_ids.length > 0 ? Subject.findByIds(scope.subject_ids) : Promise.resolve([]);
        const [subjects, posts, recentMessages, chatAgentState] = await Promise.all([
          subjectQuery,
          Post.listContextPosts({ postIds: scope.post_ids, subjectIds: scope.subject_ids, limit: MAX_POSTS_FOR_CONTEXT }),
          ChatMessageEntity.listRecentMessages(input.chatId, MAX_CHAT_HISTORY, 'id,role,content,created_at'),
          loadChatWorkflowState(input.supabase, input.chatId, input.userId),
        ]);
        const tagsBySubject = await loadSubjectTags(input.supabase, scope.subject_ids);
        return {
          scope,
          chat_agent_state: chatAgentState,
          subjects: (subjects || []).map((subject: any) => ({
            id: subject.id,
            name: subject.name || null,
            description: subject.description || null,
            summary_line: subject?.metadata?.summary_last_line || null,
            tags: tagsBySubject.get(subject.id) || [],
            metadata: subject.metadata || null,
          })),
          posts: (posts || []).map((post: any) => ({
            id: post.id,
            subject_id: post.subject_id || null,
            title: post.title || null,
            narrative_excerpt: toExcerpt(post.narrative),
            metadata: post.metadata || null,
            created_at: post.created_at || null,
          })),
          recent_chat_messages: (recentMessages || [])
            .slice()
            .reverse()
            .map((message: any) => ({
              id: Number(message.id),
              role: message.role,
              content: toExcerpt(message.content, 1000) || '',
              created_at: message.created_at || null,
            })),
        } as AgentConversationContext;
      },
    );

    // prettier-ignore
    logger.info('agent.context.completed', { chat_id: input.chatId, subjects: context.subjects.length, posts: context.posts.length, messages: context.recent_chat_messages.length, duration_ms: Date.now() - startedAt, });

    return context;
  } catch (error) {
    logger.error('agent.context.failed', { chat_id: input.chatId, duration_ms: Date.now() - startedAt, error: toErrorMeta(error) });
    throw error;
  }
}
