import { listSelectableAIAgents } from '@connectingmatrix/ai-agents/services/ai-agents/runtime/agent-service';
import type { AgentUiScopeInput } from '@connectingmatrix/ai-agents/services/ai-agents/contracts';

export const agentUiChatResolvers = {
  Query: {
    async agentUiChatBootstrap(_parent: unknown, args: { input?: { chatId?: string | null; scope?: AgentUiScopeInput | null } | null }) {
      const availableAgents = await listSelectableAIAgents(args.input?.scope || undefined);
      return {
        endpoint: '/ws/chat',
        transport: 'socket.agent-ui',
        chatId: args.input?.chatId || null,
        selectedAgentId: null,
        availableAgents,
        outputContract: {
          blocks: ['markdown', 'terminal', 'chart', 'chart-group', 'excel', 'file', 'workflow', 'banner', 'confirmation'],
          chartGroupSyntax: '[chart-group] [chart 1/3]{...}[/chart] [/chart-group]',
          excelSyntax: '[EXCEL]storage://path/to/file.xlsx[/EXCEL]',
          fileSyntax: '[file title="Report"]storage://path[/file]',
        },
      };
    },
  },
};
