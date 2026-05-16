import { safeJsonParse } from 'giga-ai-helper';
import { openai } from '@giga/shared/services/common/openai-client';
import { openAIResponsesModelProfile } from '@connectingmatrix/ai-agents/services/ai-agents/io/model-profile';
import { FinalDecision, FinalDecisionMode } from './types';

function normalizeMode(value: unknown, allowed: FinalDecisionMode[]): FinalDecisionMode | null {
  const mode = String(value || '').trim() as FinalDecisionMode;
  return allowed.includes(mode) ? mode : null;
}

export async function decideFinalResponse(input: { allowedModes: FinalDecisionMode[]; compactedContext: string }): Promise<FinalDecision> {
  const prompt = [
    'Decide whether the chat agent has enough information to answer.',
    'Return strict JSON only.',
    '',
    `Allowed modes: ${input.allowedModes.join(', ')}`,
    '',
    'Mode rules:',
    '- final: compose the answer from existing action results.',
    '- read_pass: run one more read-only Giga pass for missing workflow/content/attachment context.',
    '- full_gated_pass: run one full planner pass; backend will confirmation-gate mutations.',
    '',
    'Compacted execution context:',
    input.compactedContext,
    '',
    'Output exactly: {"mode":"final|read_pass|full_gated_pass","reason":"short reason"}',
  ].join('\n');

  const response = await openai.responses.create({
    ...openAIResponsesModelProfile(),
    instructions: 'Return strict JSON only. Do not use markdown.',
    input: prompt,
    temperature: 0,
  });
  const parsed = safeJsonParse(String(response.output_text || ''));
  const mode = normalizeMode((parsed as any)?.mode, input.allowedModes);
  if (!parsed || !mode) throw new Error('Final response decider returned invalid JSON.');
  return { mode, reason: String((parsed as any).reason || '').trim() || 'No reason provided.' };
}
