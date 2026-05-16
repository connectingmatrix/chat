import { AgentConversationContext } from '@giga/shared/types/contracts/agent.types';
import { SourceReference } from '@giga/shared/types/contracts/graphql.types';

type ScopeRef = {
  organizationId?: string | null;
  type?: 'channel' | 'category' | 'subject' | 'post' | null;
  id?: string | null;
  name?: string | null;
};

const appUrl = (scope: ScopeRef, type: string, id: string, name?: string | null): string => {
  const prefix = scope.organizationId ? `/org/${encodeURIComponent(scope.organizationId)}` : '';
  const label = name ? `?${type}Name=${encodeURIComponent(name)}` : '';
  return `${prefix}/chat/${type}/${encodeURIComponent(id)}${label}`;
};

const label = (kind: string, name: string | null | undefined, id: string): string => `${kind}: ${name || id}`;

const contextPost = (context: AgentConversationContext, id?: string | null) => (id ? context.posts.find((post) => post.id === id) || null : null);
const contextSubject = (context: AgentConversationContext, id?: string | null) =>
  id ? context.subjects.find((subject) => subject.id === id) || null : null;

export function enrichChatSourceLinks(sources: SourceReference[], context: AgentConversationContext, scope: ScopeRef): SourceReference[] {
  return sources.map((source) => {
    const post = contextPost(context, source.post_id);
    const subject = contextSubject(context, source.subject_id || post?.subject_id || null);
    if (source.post_id) {
      return {
        ...source,
        title: source.title || label('Post', post?.title, source.post_id),
        url: source.url || appUrl(scope, 'post', source.post_id, post?.title),
        snippet: source.snippet || post?.narrative_excerpt || null,
      };
    }
    if (source.subject_id) {
      return {
        ...source,
        title: source.title || label('Subject', subject?.name, source.subject_id),
        url: source.url || appUrl(scope, 'subject', source.subject_id, subject?.name),
        snippet: source.snippet || subject?.description || null,
      };
    }
    if (source.channel_id)
      return {
        ...source,
        title: source.title || label('Channel', scope.type === 'channel' ? scope.name : null, source.channel_id),
        url: source.url || appUrl(scope, 'channel', source.channel_id, scope.type === 'channel' ? scope.name : null),
      };
    if (source.category_id)
      return {
        ...source,
        title: source.title || label('Category', scope.type === 'category' ? scope.name : null, source.category_id),
        url: source.url || appUrl(scope, 'category', source.category_id, scope.type === 'category' ? scope.name : null),
      };
    return source;
  });
}

export function scopeSourceLink(scope: ScopeRef): SourceReference | null {
  if (!scope.type || !scope.id || (scope.type !== 'channel' && scope.type !== 'category')) return null;
  return {
    [`${scope.type}_id`]: scope.id,
    source_type: 'metadata',
    title: label(scope.type === 'channel' ? 'Channel' : 'Category', scope.name, scope.id),
    url: appUrl(scope, scope.type, scope.id, scope.name),
    snippet: null,
  } as SourceReference;
}
