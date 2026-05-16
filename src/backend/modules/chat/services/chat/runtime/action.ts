import { searchSerpWeb } from 'giga-ai-helper/serp-search';
import { unique } from 'giga-ai-helper';
import { getScopedLogger, toErrorMeta } from '@connectingmatrix/logger/lib/logger';
import { AgentActionDefinition, AgentActionName, AgentActionResult, AgentActionRuntime } from '@giga/shared/types/contracts/agent.types';
import { RetrievedChunk, SourceReference } from '@giga/shared/types/contracts/graphql.types';
import { openai } from '@giga/shared/services/common/openai-client';
import { openAIResponsesModelProfile } from '@connectingmatrix/ai-agents/services/ai-agents/io/model-profile';
import { Subject } from '@connectingmatrix/orm/repositories/entities/tree/Subject';
import { SubjectTagEntity } from '@connectingmatrix/orm/repositories/entities/runtime/SubjectTagEntity';
import { TagEntity } from '@connectingmatrix/orm/repositories/entities/runtime/TagEntity';
import { ChatMessageEntity } from '@connectingmatrix/orm/repositories/entities/runtime/ChatMessageEntity';
import { ChatEntity } from '@connectingmatrix/orm/repositories/entities/runtime/ChatEntity';
import { ChunkEntity } from '@connectingmatrix/orm/repositories/entities/runtime/ChunkEntity';
import { getActionCatalog as getUnifiedActionCatalog, withActionName } from '@giga/ai-actions';
import { executeBackendAgentCommand } from '@giga/execute-backend/services/agent/execute-backend/execute-backend';
import { EntityRequestContext } from '@connectingmatrix/orm/orm/request-entity-context';
import { runCreateChart } from '../actions/runtime/chart';
import { executeGigaAction, isGigaAction } from '../actions';
import { retrieve } from './retrieval';
import { compactActionValue } from './action-value';
import type { SubjectReferenceLink } from '@giga/shared/types/contracts/chat.types';

const MAX_ACTION_RESULTS_CHARS = 10000;
const MAX_DB_CHUNKS_FOR_ANALYSIS = 400;
const MAX_USER_CHATS_FOR_SCAN = 200;
const MAX_CHAT_MESSAGES_FOR_INTENT = 50;

function clamp(value: any, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function toJsonString(value: any, maxChars = MAX_ACTION_RESULTS_CHARS) {
  const text = JSON.stringify(value, null, 2);
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

function extractKeywords(text: string) {
  return unique(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .map((value) => value.trim())
      .filter((value) => value.length >= 4),
  ).slice(0, 12);
}

function toSourceFromChunk(chunk: RetrievedChunk): SourceReference {
  return {
    source_type: 'chunk',
    chunk_id: chunk.chunk_id,
    post_id: chunk.post_id,
    attachment_id: chunk.attachment_id,
    subject_id: chunk.subject_id,
    similarity: chunk.similarity ?? null,
    rank: chunk.rank ?? null,
  };
}

function toSourceFromWeb(entry: { title: string; link: string; snippet: string }): SourceReference {
  return {
    source_type: 'web',
    title: entry.title || null,
    url: entry.link || null,
    snippet: entry.snippet || null,
  };
}

const logger = getScopedLogger('agent-action-service');

export function getActionCatalog(): AgentActionDefinition[] {
  return getUnifiedActionCatalog();
}

async function analyzeTextWithModel(input: { title: string; prompt: string; maxChars?: number }) {
  const response = await openai.responses.create({
    ...openAIResponsesModelProfile(),
    instructions: 'You are an AI analyst for a production RAG agent. Return concise markdown with explicit caveats when uncertain.',
    input: input.prompt.slice(0, input.maxChars || MAX_ACTION_RESULTS_CHARS),
    temperature: 0.2,
  });
  return (response.output_text || '').trim();
}

async function loadSubjectWithTags(supabase: any, subjectId: string) {
  const subject = await Subject.readScopeRow(subjectId);
  if (!subject) return null;

  const subjectTags = await SubjectTagEntity.findBySubjectId(subjectId);
  const tagIds = unique(subjectTags.map((row) => String(row.tag_id || '')));
  let tags: string[] = [];
  if (tagIds.length) {
    const tagsRows = await TagEntity.findByIds(tagIds.map((tagId) => Number(tagId)).filter((tagId) => Number.isFinite(tagId)));
    tags = unique(tagsRows.map((row) => String(row.slug || '')).filter(Boolean));
  }

  const row = subject as {
    id?: string | null;
    name?: string | null;
    description?: string | null;
    metadata?: Record<string, unknown> | null;
  };
  return {
    id: row.id || '',
    name: row.name || '',
    description: row.description || '',
    metadata: row.metadata || {},
    tags,
  };
}

function mergeSubjectReferenceLinks(existingLinks: SubjectReferenceLink[], discoveredLinks: SubjectReferenceLink[]) {
  const byUrl = new Map<string, SubjectReferenceLink>();
  [...existingLinks, ...discoveredLinks].forEach((entry) => {
    const url = String(entry.url || '').trim();
    if (!url) return;
    byUrl.set(url, {
      title: String(entry.title || '').trim(),
      url,
      snippet: String(entry.snippet || '').trim(),
      source: entry.source || null,
      discovered_at: entry.discovered_at || new Date().toISOString(),
    });
  });
  return Array.from(byUrl.values()).slice(0, 40);
}

async function runSearchWebWithTags(runtime: AgentActionRuntime, actionInput: Record<string, any> | undefined) {
  const keywordBundle = unique([
    ...runtime.context.scope.tag_slugs,
    ...runtime.context.subjects.map((subject) => subject.name || ''),
    ...extractKeywords(runtime.message),
  ]);

  const query = String(actionInput?.query || '').trim() || unique([runtime.message, keywordBundle.slice(0, 8).join(' ')]).join(' ');
  const maxResults = clamp(actionInput?.max_results, 1, 12, 6);

  const search = await searchSerpWeb({
    query,
    num: maxResults,
    location: 'United States',
    hl: 'en',
  });

  const webSources = search.items.map((entry) => toSourceFromWeb(entry));

  return {
    summary: `Found ${search.items.length} web references for query "${search.query}".`,
    data: {
      query: search.query,
      engine: search.engine,
      results: search.items,
    },
    sources: webSources,
    retrievedChunks: [] as RetrievedChunk[],
  };
}

async function runRetrieveChunksAndAnalyze(runtime: AgentActionRuntime, actionInput: Record<string, any> | undefined) {
  const topK = clamp(actionInput?.top_k, 1, 30, runtime.topK);
  const fullLimit = clamp(actionInput?.all_chunks_limit, 20, MAX_DB_CHUNKS_FOR_ANALYSIS, 120);

  const retrieval = await retrieve({
    supabase: runtime.supabase,
    question: runtime.message,
    subjectIds: runtime.context.scope.subject_ids.length ? runtime.context.scope.subject_ids : null,
    postIds: runtime.context.scope.post_ids.length ? runtime.context.scope.post_ids : null,
    topK,
  });

  const allChunksRows = await ChunkEntity.listFallbackCandidates({
    limit: fullLimit,
    subjectIds: runtime.context.scope.subject_ids.length ? runtime.context.scope.subject_ids : null,
    postIds: runtime.context.scope.post_ids.length ? runtime.context.scope.post_ids : null,
  });

  const allChunks = allChunksRows.map((row: Record<string, unknown>, index: number) => ({
    chunk_id: Number(row.id),
    subject_id: row.subject_id || null,
    post_id: row.post_id || null,
    attachment_id: row.attachment_id || null,
    source_kind: row.source_kind === 'attachment' ? 'attachment' : 'post',
    chunk_index: Number(row.chunk_index || 0),
    content: String(row.content || ''),
    token_count: row.token_count ? Number(row.token_count) : null,
    metadata: row.metadata || null,
    similarity: null,
    rank: index + 1,
  })) as RetrievedChunk[];

  const analysisPrompt = [
    `User message: ${runtime.message}`,
    '',
    'Top retrieved chunks (semantic):',
    toJsonString(
      retrieval.chunks.slice(0, 12).map((chunk) => ({
        chunk_id: chunk.chunk_id,
        subject_id: chunk.subject_id,
        post_id: chunk.post_id,
        attachment_id: chunk.attachment_id,
        similarity: chunk.similarity,
        content: chunk.content,
      })),
    ),
    '',
    `All scoped chunks sample (${Math.min(allChunks.length, 80)} shown):`,
    toJsonString(
      allChunks.slice(0, 80).map((chunk) => ({
        chunk_id: chunk.chunk_id,
        subject_id: chunk.subject_id,
        post_id: chunk.post_id,
        attachment_id: chunk.attachment_id,
        content: chunk.content,
      })),
    ),
    '',
    'Provide concise markdown analysis with: key findings, contradictions, and confidence.',
  ].join('\n');

  const analysis = await analyzeTextWithModel({
    title: 'DB Chunk Analysis',
    prompt: analysisPrompt,
    maxChars: MAX_ACTION_RESULTS_CHARS,
  });

  const sources = unique([
    ...retrieval.chunks.map((chunk) => String(chunk.chunk_id)),
    ...allChunks.slice(0, 30).map((chunk) => String(chunk.chunk_id)),
  ])
    .map((chunkId) => {
      const chunk = retrieval.chunks.find((item) => String(item.chunk_id) === chunkId) || allChunks.find((item) => String(item.chunk_id) === chunkId);
      return chunk ? toSourceFromChunk(chunk) : null;
    })
    .filter(Boolean) as SourceReference[];

  return {
    summary: analysis || `Retrieved ${retrieval.chunks.length} relevant chunks.`,
    data: {
      retrieved_count: retrieval.chunks.length,
      all_chunks_count: allChunks.length,
      analysis_markdown: analysis,
    },
    sources,
    retrievedChunks: retrieval.chunks,
  };
}

async function runSyncSubjectReferences(runtime: AgentActionRuntime, actionInput: Record<string, any> | undefined) {
  const targetSubjectIds = unique(Array.isArray(actionInput?.subject_ids) ? actionInput.subject_ids : runtime.context.scope.subject_ids);
  const maxResultsPerSubject = clamp(actionInput?.max_results_per_subject, 1, 8, 5);

  const updates: Array<{
    subject_id: string;
    links_added: number;
    total_links: number;
  }> = [];
  const sources: SourceReference[] = [];

  for (const subjectId of targetSubjectIds) {
    const subject = await loadSubjectWithTags(runtime.supabase, subjectId);
    if (!subject) continue;

    const query = unique([subject.name, subject.description, subject.tags?.join(' ') || '', 'official references guide']).join(' ');

    const search = await searchSerpWeb({
      query,
      num: maxResultsPerSubject,
      location: 'United States',
      hl: 'en',
    });

    const discoveredLinks: SubjectReferenceLink[] = search.items.map((item) => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet,
      source: item.source,
      discovered_at: new Date().toISOString(),
    }));

    const metadata = {
      ...(subject.metadata || {}),
    } as {
      [key: string]: unknown;
      agent_references?: {
        links?: SubjectReferenceLink[];
        last_synced_at?: string;
        source?: string;
      };
    };
    const existingLinks = Array.isArray(metadata.agent_references?.links) ? metadata.agent_references.links : [];
    const mergedLinks = mergeSubjectReferenceLinks(existingLinks, discoveredLinks);

    metadata.agent_references = {
      links: mergedLinks,
      last_synced_at: new Date().toISOString(),
      source: 'agent.sync_subject_references_from_web',
    };

    const subjectEntity = await Subject.single(subjectId);
    if (!subjectEntity) continue;
    await subjectEntity.update({ metadata });

    updates.push({
      subject_id: subjectId,
      links_added: Math.max(0, mergedLinks.length - existingLinks.length),
      total_links: mergedLinks.length,
    });

    discoveredLinks.forEach((entry) => {
      sources.push({
        source_type: 'metadata',
        subject_id: subjectId,
        title: entry.title,
        url: entry.url,
        snippet: entry.snippet,
      });
    });
  }

  return {
    summary: `Updated metadata references for ${updates.length} subject(s).`,
    data: {
      updates,
    },
    sources,
    retrievedChunks: [] as RetrievedChunk[],
  };
}

async function runRefreshSubjectMetadataLinks(runtime: AgentActionRuntime, actionInput: Record<string, any> | undefined) {
  const targetSubjectIds = unique(Array.isArray(actionInput?.subject_ids) ? actionInput.subject_ids : runtime.context.scope.subject_ids);
  const maxResultsPerSubject = clamp(actionInput?.max_results_per_subject, 1, 8, 4);

  const updates: Array<{ subject_id: string; trending_results: number }> = [];
  const sources: SourceReference[] = [];

  for (const subjectId of targetSubjectIds) {
    const subject = await Subject.readScopeRow(subjectId);
    if (!subject) continue;

    const subjectRecord = subject as {
      name?: string | null;
      metadata?: Record<string, unknown> | null;
    };
    const metadata =
      subjectRecord.metadata && typeof subjectRecord.metadata === 'object' ? { ...subjectRecord.metadata } : ({} as Record<string, unknown>);
    const agentReferences = (metadata.agent_references && typeof metadata.agent_references === 'object' ? metadata.agent_references : {}) as {
      links?: SubjectReferenceLink[];
      [key: string]: unknown;
    };
    const links = Array.isArray(agentReferences.links) ? agentReferences.links : [];

    const domains = unique(
      links.map((entry: any) => {
        try {
          return new URL(entry?.url || '').hostname;
        } catch (error) {
          return '';
        }
      }),
    );

    const query = unique([
      subjectRecord.name || '',
      'latest trends',
      domains
        .slice(0, 3)
        .map((domain) => `site:${domain}`)
        .join(' OR '),
    ]).join(' ');

    const search = await searchSerpWeb({
      query,
      num: maxResultsPerSubject,
      location: 'United States',
      hl: 'en',
    });

    metadata.agent_references = {
      ...agentReferences,
      last_trending_refresh_at: new Date().toISOString(),
      trending_links: search.items.map((entry) => ({
        title: entry.title,
        url: entry.link,
        snippet: entry.snippet,
        source: entry.source,
        discovered_at: new Date().toISOString(),
      })),
    };

    const subjectEntity = await Subject.single(subjectId);
    if (!subjectEntity) continue;
    await subjectEntity.update({ metadata });

    updates.push({
      subject_id: subjectId,
      trending_results: search.items.length,
    });

    search.items.forEach((entry) => {
      sources.push({
        source_type: 'web',
        subject_id: subjectId,
        title: entry.title,
        url: entry.link,
        snippet: entry.snippet,
      });
    });
  }

  return {
    summary: `Refreshed trend links for ${updates.length} subject(s).`,
    data: { updates },
    sources,
    retrievedChunks: [] as RetrievedChunk[],
  };
}

async function runAnalyzeChatHistoryIntent(runtime: AgentActionRuntime, actionInput: Record<string, any> | undefined) {
  const maxMessages = clamp(actionInput?.max_messages, 5, MAX_CHAT_MESSAGES_FOR_INTENT, 30);
  const messages = await ChatMessageEntity.listRecentMessages(runtime.chatId, maxMessages, 'id,role,content,created_at');

  const timeline = (messages || [])
    .slice()
    .reverse()
    .map((message: any) => ({
      id: Number(message.id),
      role: message.role,
      content: String(message.content || '').slice(0, 800),
      created_at: message.created_at,
    }));

  const analysis = await analyzeTextWithModel({
    title: 'Chat Intent Analysis',
    prompt: [
      `Current message: ${runtime.message}`,
      '',
      'Recent chat timeline:',
      toJsonString(timeline),
      '',
      'Return markdown with: likely user intent, short-term goal, long-term goal, and response style preference.',
    ].join('\n'),
    maxChars: MAX_ACTION_RESULTS_CHARS,
  });

  return {
    summary: analysis || `Analyzed ${timeline.length} prior messages for intent.`,
    data: {
      analyzed_messages: timeline.length,
      intent_markdown: analysis,
    },
    sources: [],
    retrievedChunks: [] as RetrievedChunk[],
  };
}

async function runSearchCrossSubjectKnowledge(runtime: AgentActionRuntime, actionInput: Record<string, any> | undefined) {
  const queryKeywords = extractKeywords(runtime.message);
  const messageTagCandidates = unique([...runtime.context.scope.tag_slugs, ...queryKeywords]);

  let candidateTagIds: number[] = [];
  if (messageTagCandidates.length) {
    const tags = await TagEntity.findBySlugs(messageTagCandidates);
    candidateTagIds = unique(tags.map((row) => String(row.id || '')))
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
  }

  let relatedSubjectIds: string[] = [];
  if (candidateTagIds.length) {
    const subjectTags = await SubjectTagEntity.findSubjectIdsByTagIds(candidateTagIds);
    relatedSubjectIds = unique(subjectTags.map((row) => String(row.subject_id || '')).filter(Boolean));
  }

  const currentScopeSet = new Set(runtime.context.scope.subject_ids);
  const externalSubjectIds = relatedSubjectIds.filter((subjectId) => !currentScopeSet.has(subjectId));
  const topK = clamp(actionInput?.top_k, 1, 20, 8);

  if (!externalSubjectIds.length) {
    return {
      summary: 'No cross-subject matches found from current tags/keywords.',
      data: { related_subject_ids: [] },
      sources: [],
      retrievedChunks: [] as RetrievedChunk[],
    };
  }

  const retrieval = await retrieve({
    supabase: runtime.supabase,
    question: runtime.message,
    subjectIds: externalSubjectIds,
    postIds: null,
    topK,
  });

  return {
    summary: `Found ${retrieval.chunks.length} relevant chunk(s) in ${externalSubjectIds.length} other subject(s).`,
    data: {
      related_subject_ids: externalSubjectIds,
      retrieved_count: retrieval.chunks.length,
    },
    sources: retrieval.chunks.map((chunk) => toSourceFromChunk(chunk)),
    retrievedChunks: retrieval.chunks,
  };
}

async function runScanUserChats(runtime: AgentActionRuntime, actionInput: Record<string, any> | undefined) {
  const maxChats = clamp(actionInput?.max_chats, 10, MAX_USER_CHATS_FOR_SCAN, 100);
  const sessions = await ChatEntity.listByUserScope({
    userId: runtime.userId,
    columns: 'id,title,last_message_at,created_at,scope_type,scope_id,scope_snapshot',
    range: { from: 0, to: maxChats - 1 },
  });

  if (!(sessions || []).length) {
    return {
      summary: 'No user chats found to scan.',
      data: {
        chat_count: 0,
        top_subjects: [],
      },
      sources: [],
      retrievedChunks: [] as RetrievedChunk[],
    };
  }

  const subjectUsage = new Map<string, number>();
  (sessions || []).forEach((session: any) => {
    const snapshot = session?.scope_snapshot && typeof session.scope_snapshot === 'object' ? session.scope_snapshot : {};
    const subjectIds = unique([
      ...(Array.isArray(snapshot?.subject_ids) ? snapshot.subject_ids : []),
      session?.scope_type === 'subject' ? String(session.scope_id || '').trim() : '',
      String(snapshot?.subject_id || '').trim(),
    ]).filter(Boolean);

    subjectIds.forEach((subjectId) => {
      subjectUsage.set(subjectId, (subjectUsage.get(subjectId) || 0) + 1);
    });
  });

  const topSubjects = Array.from(subjectUsage.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([subject_id, chats]) => ({ subject_id, chats }));

  return {
    summary: `Scanned ${sessions?.length || 0} chats across the user account.`,
    data: {
      chat_count: sessions?.length || 0,
      top_subjects: topSubjects,
    },
    sources: [],
    retrievedChunks: [] as RetrievedChunk[],
  };
}

async function runExtractLlmBackgroundKnowledge(runtime: AgentActionRuntime, actionInput: Record<string, any> | undefined) {
  const focus =
    String(actionInput?.focus || '').trim() ||
    unique([runtime.message, runtime.context.subjects.map((subject) => subject.name || '').join(', ')]).join(' ');

  const response = await openai.responses.create({
    ...openAIResponsesModelProfile(),
    instructions: 'Provide concise background knowledge with caveats. Mark uncertain claims. Output markdown only.',
    input: [`Focus topic: ${focus}`, 'Provide: key background, common misconceptions, and what data would validate claims.'].join('\n'),
    temperature: 0.3,
  });

  return {
    summary: (response.output_text || '').trim() || 'Generated background knowledge from LLM prior.',
    data: {
      focus,
    },
    sources: [
      {
        source_type: 'llm' as const,
        title: 'LLM prior knowledge',
        snippet: 'Model-provided contextual background without direct citation.',
      },
    ],
    retrievedChunks: [] as RetrievedChunk[],
  };
}

async function runBackendToolAction(actionName: string, actionInput: Record<string, any> | undefined, runtime: AgentActionRuntime) {
  const confirmed =
    /^(yes|y|confirm|confirmed|approve|approved|proceed|go ahead|do it|run it|execute|confirm all changes)$/i.test(
      String(runtime.message || '').trim(),
    ) || actionInput?.confirmed === true;
  const previousResults = Object.values(runtime.resultsById || {}).map((result) => ({
    action: { id: result.id, tool: result.name },
    data: result.data || null,
    output: result.data || null,
    status: result.status,
    error: result.error || null,
  }));
  const backendInput = { ...(actionInput || {}) };
  if (confirmed) backendInput.confirmed = true;
  const command = await EntityRequestContext.fromRequest(
    {
      request: (runtime.request || {}) as Record<string, unknown>,
      supabase: runtime.supabase,
    },
    async () =>
      executeBackendAgentCommand({
        tool: actionName,
        input: backendInput,
        context: {
          confirmed,
          previousResults,
          currentAction: runtime.currentAction || null,
          scopeId: runtime.scopeId || null,
          scopeType: runtime.scopeType || null,
        },
      }),
  );
  if (command.status === 'failed') throw new Error(command.error || `Action failed: ${actionName}`);
  const output =
    command.output && typeof command.output === 'object' && !Array.isArray(command.output) ? (command.output as Record<string, any>) : {};
  const summary = String(output.summary || output.message || output.text || `${actionName} completed.`).trim();
  return {
    summary: summary || `${actionName} completed.`,
    data: output,
    sources: [],
    retrievedChunks: [] as RetrievedChunk[],
  };
}

export async function executeAction(
  action: {
    id: string;
    name: AgentActionName;
    reason: string;
    input?: Record<string, any>;
  },
  runtime: AgentActionRuntime,
): Promise<{ result: AgentActionResult; retrievedChunks: RetrievedChunk[] }> {
  const startedAt = Date.now();
  logger.info('agent.action.started', { action_id: action.id, action_name: action.name, chat_id: runtime.chatId, user_id: runtime.userId });

  try {
    let output: {
      summary: string;
      data: Record<string, any>;
      sources: SourceReference[];
      retrievedChunks: RetrievedChunk[];
    };

    if (isGigaAction(action.name)) {
      output = await executeGigaAction(action.name, runtime, action.input);
    } else if (String(action.name || '').includes('.')) {
      output = await runBackendToolAction(String(action.name || ''), action.input, runtime);
    } else {
      switch (action.name) {
        case 'search_web_with_tags':
          output = await runSearchWebWithTags(runtime, action.input);
          break;
        case 'retrieve_db_chunks_and_analyze':
          output = await runRetrieveChunksAndAnalyze(runtime, action.input);
          break;
        case 'sync_subject_references_from_web':
          output = await runSyncSubjectReferences(runtime, action.input);
          break;
        case 'refresh_subject_metadata_links':
          output = await runRefreshSubjectMetadataLinks(runtime, action.input);
          break;
        case 'analyze_chat_history_intent':
          output = await runAnalyzeChatHistoryIntent(runtime, action.input);
          break;
        case 'search_cross_subject_knowledge':
          output = await runSearchCrossSubjectKnowledge(runtime, action.input);
          break;
        case 'scan_user_chats':
          output = await runScanUserChats(runtime, action.input);
          break;
        case 'extract_llm_background_knowledge':
          output = await runExtractLlmBackgroundKnowledge(runtime, action.input);
          break;
        case 'create_chart':
          output = await runCreateChart(runtime, action.input);
          break;
        default:
          output = {
            summary: `Action ${action.name} is not implemented.`,
            data: {},
            sources: [],
            retrievedChunks: [],
          };
          break;
      }
    }

    const result: AgentActionResult = {
      id: action.id,
      name: action.name,
      status: 'completed',
      reason: action.reason,
      summary: output.summary,
      data: compactActionValue(withActionName(action.name, output.data || null)) as Record<string, any> | null,
      sources: output.sources || [],
      error: null,
      duration_ms: Date.now() - startedAt,
    };

    // prettier-ignore
    logger.info('agent.action.completed', { action_id: action.id, action_name: action.name, status: result.status, sources: result.sources.length, duration_ms: result.duration_ms, });

    return {
      result,
      retrievedChunks: output.retrievedChunks || [],
    };
  } catch (error) {
    const result: AgentActionResult = {
      id: action.id,
      name: action.name,
      status: 'failed',
      reason: action.reason,
      summary: `Action failed: ${action.name}`,
      data: null,
      sources: [],
      error: String((error as any)?.message || 'Unknown action execution error'),
      duration_ms: Date.now() - startedAt,
    };

    // prettier-ignore
    logger.error('agent.action.failed', { action_id: action.id, action_name: action.name, duration_ms: result.duration_ms, error: toErrorMeta(error), });

    return {
      result,
      retrievedChunks: [],
    };
  }
}
