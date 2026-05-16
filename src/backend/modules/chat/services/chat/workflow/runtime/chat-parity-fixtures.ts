import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Executor } from '@workflow/executor';
import type { WorkflowDefinition } from '@giga/shared/types/contracts/workflow.types';

export const CHAT_PARITY_VARIANTS = {
  legacy: {
    bootstrapKey: 'chat-workflow-parity',
    channelName: 'Chat Parity Debug',
    fixtureDir: 'chat-parity',
    fixtureFile: 'chat-parity-workflow.cypher',
    compiledFile: 'chat-parity-workflow.compiled.json',
    workflowName: 'Chat Workflow Parity',
  },
  'ai-agent': {
    bootstrapKey: 'chat-workflow-parity-ai-agent',
    channelName: 'Chat Parity Debug AI Agent',
    fixtureDir: 'chat-parity-ai-agent',
    fixtureFile: 'chat-parity-ai-agent-workflow.cypher',
    compiledFile: 'chat-parity-ai-agent-workflow.compiled.json',
    workflowName: 'Chat Workflow Parity AI Agent',
  },
} as const;

export type ChatParityVariant = keyof typeof CHAT_PARITY_VARIANTS;

export function chatParityVariant(value?: string): ChatParityVariant {
  return value === 'ai-agent' ? 'ai-agent' : 'legacy';
}

export function chatParityFixturePath(variant: ChatParityVariant, kind: 'cypher' | 'compiled'): string {
  const config = CHAT_PARITY_VARIANTS[variant];
  const file = kind === 'compiled' ? config.compiledFile : config.fixtureFile;
  return join(process.cwd(), 'packages/apps/chat/src/services/chat/workflow', config.fixtureDir, file);
}

export function readChatParityFixture(variant: ChatParityVariant) {
  const config = CHAT_PARITY_VARIANTS[variant];
  const cypher = readFileSync(chatParityFixturePath(variant, 'cypher'), 'utf8');
  const compiled = Executor.compileWorkflowCypher({
    cypher,
    name: config.workflowName,
    description: `${config.workflowName} fixture.`,
    executable: true,
  });
  if (!compiled.validation.ok) {
    throw new Error(`${config.workflowName} fixture is invalid: ${compiled.validation.errors.join(' | ')}`);
  }
  return {
    config,
    cypher,
    workflow: compiled.workflow as WorkflowDefinition,
  };
}
