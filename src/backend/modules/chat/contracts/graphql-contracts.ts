import type { GraphqlOperationContract, RoleGateContract } from '@giga/shared/types/contracts/integration-contract.types';

const roles: RoleGateContract[] = [
  { actor: 'User', canInvoke: true, constraints: ['Authenticated chat scope required.'] },
  { actor: 'Root User', canInvoke: true, constraints: ['Root scope access still checks policy/permissions.'] },
  { actor: 'Super Admin', canInvoke: true, constraints: ['Super-admin scope still checks org/global policy.'] },
];

const sourcePaths = ['packages/apps/chat/src/services/chat/read/query-chat.ts', 'packages/apps/chat/src/services/chat/runtime/agent-router.ts'];

const row = (operationName: string, inputType: string, outputType: string, notes: string[]): GraphqlOperationContract => ({
  packageName: '@connectingmatrix/chat',
  operationName,
  kind: 'MUTATION',
  inputType,
  outputType,
  description: 'Chat execution surface composed by integration resolver and executed by @connectingmatrix/chat runtime.',
  parameters: [
    { name: 'input.message', type: 'string', required: true, description: 'User message.' },
    { name: 'input.chat_mode', type: 'DEFAULT|AGENT|WORKFLOW|SWARM', required: false, description: 'Runtime mode selector.' },
    { name: 'input.agent_id', type: 'string', required: false, description: 'Required for AGENT mode.' },
    { name: 'input.workflow_id', type: 'string', required: false, description: 'Required for WORKFLOW mode.' },
    { name: 'input.swarm_id', type: 'string', required: false, description: 'Optional for SWARM mode.' },
  ],
  combinations: [
    {
      name: 'DEFAULT',
      required: ['input.message'],
      optional: ['input.chat_mode'],
      constraints: ['Current truth: DEFAULT can route through rule/attachment/internal routing before fallback.'],
    },
    {
      name: 'AGENT',
      required: ['input.message', 'input.chat_mode', 'input.agent_id'],
      optional: [],
      constraints: ['Rejected when agent_id missing.'],
    },
    {
      name: 'WORKFLOW',
      required: ['input.message', 'input.chat_mode', 'input.workflow_id'],
      optional: [],
      constraints: ['Rejected when workflow_id missing.'],
    },
    {
      name: 'SWARM',
      required: ['input.message', 'input.chat_mode'],
      optional: ['input.swarm_id'],
      constraints: ['Supports explicit swarm dispatch.'],
    },
  ],
  roleGates: roles,
  sourcePaths,
  notes,
});

export const GRAPHQL_CONTRACTS: GraphqlOperationContract[] = [
  row('chatQuery', 'ChatQueryInput', 'ChatQueryPayload', [
    'Truth mode: DEFAULT currently honors rule/attachment/internal routing.',
    'Target delta requested by product: DEFAULT should bypass attachments and execute pure plan/action path.',
  ]),
  row('chatSend', 'ChatQueryInput', 'ChatQueryPayload', [
    'Same runtime behavior as chatQuery with compatibility naming.',
    'Target delta mirrors chatQuery DEFAULT-mode behavior request.',
  ]),
];

export const NO_GRAPHQL_SURFACE_REASON = '';
