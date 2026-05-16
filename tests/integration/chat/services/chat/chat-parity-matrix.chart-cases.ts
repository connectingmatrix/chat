import assert from 'node:assert/strict';
import { extractWorkflowChartMarkdownBlocks, parseWorkflowChartMarkdownPayload } from '@workflow/charts';
import { readWorkflowRow } from './chat-parity-matrix.state';
import { MatrixContext, requireTrace, runPrompt } from './chat-parity-matrix.helpers';

const chartMessage = 'Create a bar chart showing monthly revenue for Jan, Feb, and Mar.';

function assertChartMarkup(markdown: string) {
  assert.match(markdown, /\[chart\]/, markdown);
  assert.match(markdown, /\[\/chart\]/, markdown);
  const blocks = extractWorkflowChartMarkdownBlocks(markdown);
  assert.equal(blocks.length > 0, true, markdown);
  const payload = parseWorkflowChartMarkdownPayload(blocks[0].payload);
  assert.equal(Boolean(payload.type), true, JSON.stringify(payload));
  assert.equal(Boolean(payload.data), true, JSON.stringify(payload));
  assert.equal(Boolean(payload.properties), true, JSON.stringify(payload));
  assert.doesNotThrow(() => JSON.parse(payload.data));
  assert.doesNotThrow(() => JSON.parse(payload.properties));
  assert.equal(Boolean(payload.chart?.spec?.data), true, JSON.stringify(payload.chart));
}

export async function runChartMarkupCase(context: MatrixContext) {
  const result = await runPrompt({ ...context, message: chartMessage, expectConfirmation: false });
  assert.equal(result.final.agent?.response_format, 'chart_output', JSON.stringify(result.final, null, 2));
  assertChartMarkup(result.text);
  requireTrace(result, context.system);
}

export const chartOutputPrompts = [
  'Create a pie chart of browser market share for Chrome, Safari, Edge, and Firefox.',
  'Create a line chart of weekly active users for week 1 to week 8.',
  'Create a stacked bar chart for Q1, Q2, Q3 sales by product A and product B.',
  'Create a scatter chart for ad spend vs conversions with 10 data points.',
  'Create an area chart for monthly signups and churn across Jan to Dec.',
  'Create a donut chart showing budget split across engineering, marketing, support, and ops.',
  'Create a histogram-like bar chart for response times grouped by 0-100ms, 100-200ms, 200-300ms.',
  'Create a radar chart comparing features reliability, speed, usability, security, and flexibility.',
  'Create a bubble chart for campaign reach, clicks, and spend.',
  'Create a combo chart with bars for revenue and line for profit margin by month.',
] as const;

export const chartWorkflowSpecs = [
  { workflow: 'Chart Revenue Workflow', ask: 'monthly revenue by region' },
  { workflow: 'Chart Engagement Workflow', ask: 'weekly engagement by cohort' },
  { workflow: 'Chart Churn Workflow', ask: 'monthly churn by plan type' },
  { workflow: 'Chart Support Workflow', ask: 'tickets by priority and week' },
  { workflow: 'Chart Growth Workflow', ask: 'user growth by month' },
  { workflow: 'Chart Retention Workflow', ask: 'retention by week for 8 weeks' },
  { workflow: 'Chart Sales Workflow', ask: 'sales by category for Q1 to Q4' },
  { workflow: 'Chart Finance Workflow', ask: 'expenses by department' },
  { workflow: 'Chart Traffic Workflow', ask: 'traffic sources by percentage' },
  { workflow: 'Chart Productivity Workflow', ask: 'team velocity by sprint' },
] as const;

export async function runChartOutputPromptCase(context: MatrixContext, prompt: string) {
  const result = await runPrompt({ ...context, message: prompt, expectConfirmation: false });
  assert.equal(result.final.agent?.response_format, 'chart_output', JSON.stringify(result.final, null, 2));
  assertChartMarkup(result.text);
}

export async function runChartWorkflowPromptCase(context: MatrixContext, workflowNamePrefix: string, request: string) {
  const key = context.scope.id.slice(0, 6);
  const workflowName = `${workflowNamePrefix} ${key}`;
  const create = await runPrompt({
    ...context,
    message: `Create a workflow named "${workflowName}" that returns a chart for ${request} and do not run it.`,
  });
  assert.equal(create.pending.done.data.agent?.requires_confirmation, true, JSON.stringify(create.pending.done.data, null, 2));
  const row = await readWorkflowRow(context.session.userId, workflowName);
  assert.equal(Boolean(row?.id), true, workflowName);
  const run = await runPrompt({
    ...context,
    message: `Execute the workflow "${workflowName}" and return the chart output here.`,
  });
  assert.equal(run.final.agent?.response_format, 'chart_output', JSON.stringify(run.final, null, 2));
  assertChartMarkup(run.text);
}
