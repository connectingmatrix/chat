import { buildChartSelectionPrompt, createWorkflowChart, parseChartSelectionResponse, serializeWorkflowChartMarkdown } from '@workflow/charts';
import { AgentActionRuntime } from '@giga/shared/types/contracts/agent.types';
import { openai } from '@giga/shared/services/common/openai-client';
import { openAIResponsesModelProfile } from '@connectingmatrix/ai-agents/services/ai-agents/io/model-profile';
import type { ChartInputs, ChartLayout } from '@workflow/charts';

function textValue(value: unknown): string {
  return String(value || '').trim();
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function layoutValue(input: Record<string, unknown>): Partial<ChartLayout> {
  const height = Number(input.layout_height || input.layoutHeight || 360);
  const span = Number(input.col_span || input.colSpan || 12);
  return {
    height: Number.isFinite(height) ? Math.max(120, Math.floor(height)) : 360,
    colSpan: span === 3 || span === 4 || span === 6 ? span : 12,
  };
}

function selectedInputs(input: Record<string, unknown>): ChartInputs {
  return recordValue(input.selected_inputs || input.selectedInputs) as ChartInputs;
}

export async function runCreateChart(runtime: AgentActionRuntime, actionInput: Record<string, unknown> | undefined) {
  const input = recordValue(actionInput);
  const prompt = textValue(input.prompt || input.request || runtime.message);
  if (!prompt) throw new Error('Chart prompt is required.');

  const response = await openai.responses.create({
    ...openAIResponsesModelProfile(),
    instructions: 'Return strict JSON only. Do not include markdown fences or prose.',
    input: buildChartSelectionPrompt(prompt),
    temperature: 0.2,
  });

  const selection = parseChartSelectionResponse(String(response.output_text || ''));
  const chart = createWorkflowChart({
    prompt,
    libraryId: textValue(input.library_id || input.libraryId || 'auto') || 'auto',
    chartTemplateId: textValue(input.chart_template_id || input.chartTemplateId || 'auto') || 'auto',
    selectedInputs: selectedInputs(input),
    layout: layoutValue(input),
    selection,
    source: 'openai',
  });
  const markup = serializeWorkflowChartMarkdown(chart);

  return {
    summary: `Created ${chart.chartName} with ${chart.libraryName}.`,
    data: { markup, markdown: markup, chart, type: 'chart', version: 1 },
    sources: [],
    retrievedChunks: [],
  };
}
