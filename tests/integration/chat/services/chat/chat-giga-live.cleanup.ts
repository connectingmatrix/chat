import assert from 'node:assert/strict';
import { Neo4JConnection } from '@giga/general/decorators/runtime/neo';
import { SupabaseClientAdmin } from '@giga/general/decorators/integration/supabase-admin-client';
import { TreeGraphEntity } from '@giga/tree/services/giga/tree/runtime/system';
import { GRAPH_LABELS } from '@giga/shared/types/contracts/graph.types';
import { CreatedIds, setList } from './chat-giga-live.ids';

function numberValue(value: any) {
  return Number(value?.low ?? value ?? 0);
}

async function resetNeoConnection() {
  const current = (Neo4JConnection as any).instance;
  const driver = current?.driver?.driver;
  if (driver?.close) await driver.close();
  (Neo4JConnection as any).instance = null;
}

async function graphCount(ids: string[]) {
  if (!ids.length) return 0;
  const rows = await (
    await TreeGraphEntity.getNeo()
  ).run<{ count: number }>(
    `
      MATCH (n)
      WHERE (
        n:${GRAPH_LABELS.channel}
        OR n:${GRAPH_LABELS.category}
        OR n:${GRAPH_LABELS.subjectRef}
      )
      AND n.id IN $ids
      RETURN count(n) AS count
    `,
    { ids },
  );
  return numberValue(rows[0]?.count);
}

export async function cleanupCreated(ids: CreatedIds): Promise<void> {
  const admin = SupabaseClientAdmin();
  const chatIds = setList(ids.chats);
  const channelIds = setList(ids.channels);
  const postIds = setList(ids.posts);
  const subjectIds = setList(ids.subjects);
  const workflowIds = setList(ids.workflows);
  const graphIds = [...channelIds, ...setList(ids.categories), ...subjectIds];

  if (chatIds.length) await admin.from('ai_chat_messages').delete().in('chat_id', chatIds);
  if (chatIds.length) await admin.from('ai_chat_sessions').delete().in('id', chatIds);
  if (workflowIds.length) await admin.from('ai_workflow_assignments').delete().in('workflow_id', workflowIds);
  if (channelIds.length) await admin.from('ai_workflow_assignments').delete().eq('scope_type', 'CHANNEL').in('scope_id', channelIds);
  if (workflowIds.length) await admin.from('ai_workflow_executions').delete().in('workflow_id', workflowIds);
  if (workflowIds.length) await admin.from('ai_workflows').delete().in('id', workflowIds);
  if (postIds.length) await admin.from('ai_posts').delete().in('id', postIds);
  if (subjectIds.length) await admin.from('ai_subjects').delete().in('id', subjectIds);

  if (graphIds.length) {
    await (
      await TreeGraphEntity.getNeo()
    ).run(
      `
        MATCH (n)
        WHERE (
          n:${GRAPH_LABELS.channel}
          OR n:${GRAPH_LABELS.category}
          OR n:${GRAPH_LABELS.subjectRef}
        )
        AND n.id IN $ids
        DETACH DELETE n
      `,
      { ids: graphIds },
    );
    assert.equal(await graphCount(graphIds), 0, 'Expected no leftover Giga graph nodes from live chat test.');
  }

  await resetNeoConnection();
}
