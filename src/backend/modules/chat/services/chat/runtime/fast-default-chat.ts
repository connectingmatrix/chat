import type { QueryChatInput, ResolvedChatScope, ChatScope } from '@connectingmatrix/chat/services/chat/contracts/types';
import type { AgentExecutionOutput } from '@giga/shared/types/contracts/agent.types';

type FastDefaultParams = {
  attachments: NonNullable<QueryChatInput['attachments']>;
  input: QueryChatInput;
  resolvedScope: ResolvedChatScope;
  scope: ChatScope;
};

const needsAdvancedRuntime = (message: string): boolean =>
  /\b(create|build|deploy|run|execute|workflow|node|agent|swarm|project|database|db|schema|migration|delete|update|ingest)\b/i.test(message);

const attachmentLines = (attachments: NonNullable<QueryChatInput['attachments']>): string[] =>
  attachments.map((file) => `- ${file.file_name || file.drive_path} (${file.mime_type || file.kind || 'file'})`).filter(Boolean);

export const buildFastDefaultChatExecution = async (params: FastDefaultParams): Promise<AgentExecutionOutput> => {
  const message = params.input.message.trim();
  const attachments = attachmentLines(params.attachments);
  const normalized = message.toLowerCase();
  const slashResponse = normalized.startsWith('/workflow list')
    ? 'Workflow list requested. Open `/workflows` to manage workflows, or ask me to create, edit, validate, run, or delete a workflow.'
    : normalized.startsWith('/tree')
      ? 'Tree operations requested. Open `/tree` or `/explore` to browse Channels, Categories, Subjects, and Posts. You can ask me to create, update, link, unlink, or inspect tree objects.'
      : '';
  const advanced = !slashResponse && needsAdvancedRuntime(message);
  const attachmentText = attachments.length ? attachments.join('\n') : '';
  const text = slashResponse
    ? [slashResponse, attachmentText ? `Attached context received from Drive:\n${attachmentText}` : ''].filter(Boolean).join('\n\n')
    : advanced
      ? [
        'I can help with this. I prepared the request for the planner and will ask for confirmation before creating, updating, deleting, executing, deploying, or launching advanced agents.',
        attachmentText ? `Attached context:\n${attachmentText}` : '',
        'Please confirm the action scope and I will continue with the required execution path.',
      ]
        .filter(Boolean)
        .join('\n\n')
      : [message ? 'Here is a quick response from Default mode.' : 'How can I help?', attachmentText ? `Attached context received from Drive:\n${attachmentText}` : '']
        .filter(Boolean)
        .join('\n\n');

  return {
    action_results: [],
    intent: advanced ? 'Prepare confirmation-gated plan.' : 'Answer quickly in Default mode.',
    markdown: text,
    plan: { intent: advanced ? 'Prepare confirmation-gated plan.' : 'Fast default response.', actions: [] },
    retrieved_chunks: [],
    scope: {
      post_ids: params.resolvedScope.post_ids || [],
      scope_id: params.scope.id || null,
      scope_type: params.scope.type || null,
      subject_ids: params.resolvedScope.subject_ids || [],
      tag_slugs: params.input.tagSlugs || [],
    },
    sources: [],
  };
};
