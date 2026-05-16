import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentPipelinePass } from '@giga/shared/types/contracts/agent.types';
import { compactFinalContext } from '../../../src/services/chat/final-response/compact';

test('compactFinalContext keeps bounded pass metadata', () => {
  const passes: AgentPipelinePass[] = [
    {
      kind: 'initial',
      response_format: 'general',
      plan: {
        intent: 'Read a post',
        actions: [{ id: 'a1', name: 'read_post', reason: 'Need post detail', input: { id: 'post-1' } }],
      },
      action_results: [
        {
          id: 'a1',
          name: 'read_post',
          status: 'completed',
          reason: 'Need post detail',
          summary: 'Read post',
          data: { narrative: 'x'.repeat(6000) },
          sources: [],
          duration_ms: 1,
        },
      ],
    },
  ];

  const compacted = compactFinalContext({
    message: 'Should I update this post?',
    context: { scope: { subject_ids: [], post_ids: [], tag_slugs: [] }, subjects: [], posts: [], recent_chat_messages: [] },
    passes,
  });

  assert.equal(compacted.exceeded, false);
  assert.equal(compacted.text.includes('read_post'), true);
  assert.equal(compacted.text.length < 28000, true);
});
