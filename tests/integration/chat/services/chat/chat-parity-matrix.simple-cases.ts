import assert from 'node:assert/strict';
import { plainText, runPrompt, MatrixContext } from './chat-parity-matrix.helpers';

export const simplePrompts = [
  'Hey there',
  'Good morning',
  'Can you help me?',
  'What can you do for me in this workspace?',
  'I need quick guidance',
  'Do you support creating channels and workflows?',
  'How should I start organizing my knowledge tree?',
  'Give me one short tip for Giga Chat usage',
] as const;

export async function runSimplePromptCase(context: MatrixContext, prompt: string) {
  const response = await runPrompt({ ...context, message: prompt, expectConfirmation: false });
  assert.equal(plainText(response).length > 0, true);
}
