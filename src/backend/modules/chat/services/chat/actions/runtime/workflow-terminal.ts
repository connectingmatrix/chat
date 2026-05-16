import type { WorkflowDefinition } from '@giga/shared/types/contracts/workflow.types';

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function flattenStartEnvelope(value: unknown): unknown {
  const record = recordValue(value);
  if (!Object.keys(record).length || Object.prototype.hasOwnProperty.call(record, 'request')) return value;
  const nestedStartEntry = Object.entries(record).find(([, entry]) => {
    const nested = recordValue(entry);
    return Object.prototype.hasOwnProperty.call(nested, 'request') && Object.prototype.hasOwnProperty.call(nested, 'input');
  });
  if (!nestedStartEntry) return value;
  const nestedStartRecord = recordValue(nestedStartEntry[1]);
  return {
    ...record,
    ...Object.fromEntries(
      Object.entries(nestedStartRecord).filter(([key]) => key === 'request' || key === 'input' || key === 'started' || key === 'startedAt'),
    ),
  };
}

export function extractWorkflowTerminalOutput(workflow: WorkflowDefinition): unknown {
  const endNodes = (workflow.nodes || []).filter((node) => node.modelId === 'respond-end');
  const endNode = endNodes[endNodes.length - 1];
  const output =
    endNode?.ports?.out && Object.prototype.hasOwnProperty.call(endNode.ports.out, 'output') ? endNode.ports.out.output : endNode?.output;
  const record = recordValue(output);
  const keys = Object.keys(record).filter((key) => key !== '__workflow');
  if (keys.length === 1 && keys[0] === 'input') return record.input;
  return flattenStartEnvelope(output);
}

export function workflowOutputText(payload: unknown): string {
  if (typeof payload === 'string' && payload.trim()) return payload.trim();
  const record = recordValue(payload);
  for (const key of ['markup', 'markdown', 'text', 'value', 'output']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  const text = JSON.stringify(payload, null, 2);
  return text && text !== 'null' ? text : 'Workflow completed with no output.';
}
