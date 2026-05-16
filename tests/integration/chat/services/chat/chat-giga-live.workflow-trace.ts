import { io } from 'socket.io-client';
import { socketEvent } from './chat-giga-live.fixture';

export type WorkflowTraceMark = {
  eventCount: number;
  executionCount: number;
};

export async function openWorkflowTrace(port: number, sessionHeader: string, userId: string, workflowId: string) {
  const socket = io(`http://localhost:${port}`, {
    path: '/ws/workflow',
    auth: { token: sessionHeader },
    transports: ['websocket'],
  });
  const events: any[] = [];
  const executions: any[] = [];
  await socketEvent(socket, 'workflow:ready');
  socket.on('workflow:event', (event) => events.push(event));
  socket.on('workflow:execution:update', (event) => executions.push(event));
  socket.emit('workflow:catalog:subscribe', { broadcast_id: userId, channel_name: 'workflow-socket' });
  socket.emit('workflow:execution:subscribe', { broadcast_id: userId, workflow_id: workflowId });

  return {
    close: () => socket.close(),
    mark(): WorkflowTraceMark {
      return { eventCount: events.length, executionCount: executions.length };
    },
    read(mark: WorkflowTraceMark, runId: string, execution: any, logs: any[] = []) {
      const eventSlice = events.slice(mark.eventCount).filter((entry) => String(entry?.runId || '') === runId);
      const executionSlice = executions.slice(mark.executionCount);
      const nodeOrder: string[] = [];
      const seen = new Set<string>();
      let terminalEvent: any = null;
      let lastNodeState: any = null;
      let firstDivergence: any = null;

      for (const entry of [...eventSlice, ...logs]) {
        const nodeId = String(entry?.nodeId || '').trim();
        if (nodeId && !seen.has(nodeId)) {
          seen.add(nodeId);
          nodeOrder.push(nodeId);
        }
        if (entry?.event === 'node.delta') lastNodeState = entry;
        if (entry?.event === 'node.failed' && !firstDivergence) firstDivergence = entry;
        if (String(entry?.event || '').startsWith('workflow.') || entry?.event === 'node.failed') terminalEvent = entry;
      }

      if (!firstDivergence && terminalEvent && terminalEvent?.event !== 'workflow.completed') firstDivergence = terminalEvent;

      return {
        execution,
        executionUpdates: executionSlice,
        events: eventSlice,
        nodeOrder,
        terminalEvent,
        lastNodeState,
        firstDivergence,
      };
    },
  };
}
