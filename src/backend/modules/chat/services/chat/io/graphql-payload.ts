export const toGraphqlChatScope = (scope?: { type?: string | null; id?: string | null; organizationId?: string | null } | null) =>
  scope
    ? {
        type: String(scope.type || '').toUpperCase(),
        id: scope.id,
        organizationId: scope.organizationId ?? null,
      }
    : null;

export const toGraphqlChatQueryPayload = (result: any) => ({
  chat: result.chat
    ? {
        ...result.chat,
        scope: toGraphqlChatScope(result.chat.scope),
      }
    : null,
  messages: result.messages || null,
  answer: result.answer || { text: null, weak_context: true },
  sources: result.sources || [],
  agent: result.agent || null,
  debug: result.debug
    ? {
        ...result.debug,
        scope: toGraphqlChatScope(result.debug.scope),
      }
    : {
        execution_mode: null,
        workflow_source: null,
        workflow_id: null,
        execution_id: null,
        run_id: null,
        current_node: null,
        current_node_input: null,
        current_node_output: null,
        retrieved_chunks: 0,
        scope: null,
        subject_ids: [],
        post_ids: [],
      },
});
