import {
  AgentActionDefinition,
  AgentActionResult,
  AgentConversationContext,
  AgentExecutionInput,
  AgentExecutionOutput,
  AgentExecutionPlan,
  AgentPipelinePass,
} from '@giga/shared/types/contracts/agent.types';
import { RetrievedChunk, SourceReference } from '@giga/shared/types/contracts/graphql.types';

export type FinalDecisionMode = 'final' | 'read_pass' | 'full_gated_pass';

export type FinalDecision = {
  mode: FinalDecisionMode;
  reason: string;
};

export type PlanExecution = {
  orderedResults: AgentActionResult[];
  mergedSources: SourceReference[];
  mergedRetrievedChunks: RetrievedChunk[];
};

export type FinalizeInput = {
  availableActions: AgentActionDefinition[];
  context: AgentConversationContext;
  emitDebug: (stage: string, status: 'started' | 'progress' | 'completed' | 'failed', message: string, meta?: Record<string, any>) => void;
  input: AgentExecutionInput;
  initial: PlanExecution;
  passes: AgentPipelinePass[];
  plan: AgentExecutionPlan;
  runPlan: (plan: AgentExecutionPlan) => Promise<PlanExecution>;
  topK: number;
};

export type FinalizeOutput = AgentExecutionOutput;
