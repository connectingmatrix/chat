import { emitRuntimeEvent } from '@giga/process-monitoring/socket/runtime/event-bus';
import { registerRuntimeProcess, updateRuntimeProcessStatus } from '@giga/process-monitoring/services/runtime-monitor/runtime-process.registry';
import type { ChatDefaultOrchestrationPlan } from './default-orchestration';

export type ChatPlanningSubagentRuntime = {
  processId: string;
  workerId: string;
  role: string;
  status: string;
  scopeType: 'SUB_AI_AGENT' | 'SWARM_WORKER';
  parentScopeId: string;
  userId: string;
  cpu: number;
  ramMb: number;
  summary: string;
};

const defaultRoles = ['research', 'planner', 'permission-policy', 'confirmation', 'execution-router'];
const swarmRoles = ['planning', 'context', 'build', 'data', 'workflow', 'verify', 'publish', 'cleanup'];

const roleFor = (mode: ChatDefaultOrchestrationPlan['mode'], index: number) => {
  const roles = mode === 'SWARM' ? swarmRoles : defaultRoles;
  return roles[index % roles.length];
};

export function emitChatPlanningSubagentRuntimeEvents(input: {
  chatId: string;
  plan: ChatDefaultOrchestrationPlan;
  userId: string;
  agentId?: string | null;
}): ChatPlanningSubagentRuntime[] {
  const workers: ChatPlanningSubagentRuntime[] = [];
  const workerCount = Math.max(0, input.plan.initialSubagents);
  if (workerCount === 0) return workers;
  for (let index = 0; index < workerCount; index += 1) {
    const role = roleFor(input.plan.mode, index);
    const scopeType = input.plan.mode === 'SWARM' ? 'SWARM_WORKER' : 'SUB_AI_AGENT';
    const process = registerRuntimeProcess({
      userId: input.userId,
      agentId: input.agentId || null,
      parentScopeId: input.chatId,
      scopeType,
      status: 'completed',
    });
    const cpu = input.plan.mode === 'SWARM' ? 4 + (index % 9) : 1 + (index % 4);
    const ramMb = input.plan.mode === 'SWARM' ? 192 + index * 8 : 96 + index * 4;
    const summary = `${input.plan.mode === 'SWARM' ? 'Swarm' : 'Default'} ${role} subagent checked route=${input.plan.routeDecision}, confirmation=${String(input.plan.requiresConfirmation)}.`;
    updateRuntimeProcessStatus(process.processId, 'completed');
    emitRuntimeEvent({
      kind: input.plan.mode === 'SWARM' ? 'swarm.worker' : 'agent.run',
      status: 'completed',
      processId: process.processId,
      scopeType,
      parentScopeId: input.chatId,
      userId: input.userId,
      agentId: input.agentId || null,
      workerId: `${input.plan.mode.toLowerCase()}-${role}-${index + 1}`,
      iteration: index + 1,
      cpu,
      ramMb,
      message: summary,
      timestamp: new Date().toISOString(),
    });
    workers.push({
      processId: process.processId,
      workerId: `${input.plan.mode.toLowerCase()}-${role}-${index + 1}`,
      role,
      status: 'completed',
      scopeType,
      parentScopeId: input.chatId,
      userId: input.userId,
      cpu,
      ramMb,
      summary,
    });
  }
  return workers;
}
