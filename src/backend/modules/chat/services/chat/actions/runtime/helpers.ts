import { BadRequestError } from 'routing-controllers';
import { readUserMatrixState } from '@giga/permissions/manifest/user-matrix';
import { buildPermissionContext } from '@giga/permissions/services/auth/permission-context';
import { fetchUserTree, resolveAccessibleTreeNode } from '@giga/tree/services/giga/tree/read/fetchUserTree';
import { Post } from '@connectingmatrix/orm/repositories/entities/tree/Post';
import { AgentActionCapability, AgentActionRuntime, AgentActionResult } from '@giga/shared/types/contracts/agent.types';
import { RESOURCE_TYPES, ResourceType, TreeNode } from '@giga/shared/types/contracts/graph.types';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const actionTokenPattern = /^(?:\$?\{|\{\{)([a-zA-Z0-9_-]+)\.([^}]+?)(?:\}\}|\})$/;

export function recordInput(value: any) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function requiredText(input: any, key: string) {
  const value = String(recordInput(input)[key] || '').trim();
  if (!value) throw new BadRequestError(`${key} is required.`);
  return value;
}

export function optionalText(input: any, key: string) {
  return String(recordInput(input)[key] || '').trim() || undefined;
}

export function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export async function readActionCapabilities(runtime: Pick<AgentActionRuntime, 'supabase' | 'userId'>) {
  const matrix = await readUserMatrixState(runtime.supabase, { userId: runtime.userId });
  const permissions = buildPermissionContext(matrix, false) as Partial<Record<AgentActionCapability, boolean>>;
  return permissions;
}

export async function requireCapability(runtime: AgentActionRuntime, key: AgentActionCapability, label: string) {
  const permissions = runtime.capabilities || (await readActionCapabilities(runtime));
  if (permissions[key] === true) return;
  throw new BadRequestError(`Plan access does not allow ${label}.`);
}

export function resultData(runtime: AgentActionRuntime, actionId: string, key: string) {
  const data = (runtime.resultsById?.[actionId] as AgentActionResult | undefined)?.data || {};
  return recordInput(data)[key];
}

export function dependencyResultValue(runtime: AgentActionRuntime, resultKeys: string[]) {
  const dependencyIds = runtime.currentAction?.depends_on || [];
  for (const actionId of [...dependencyIds].reverse()) {
    for (const resultKey of resultKeys) {
      const value = resultData(runtime, actionId, resultKey);
      const textValue = String(value || '').trim();
      if (textValue) return textValue;
      const nestedId = String(recordInput(value).id || '').trim();
      if (nestedId) return nestedId;
    }
  }
  return '';
}

export function resultId(runtime: AgentActionRuntime, actionId: string) {
  const data = recordInput((runtime.resultsById?.[actionId] as AgentActionResult | undefined)?.data);
  const direct = ['id', 'channel_id', 'category_id', 'subject_id', 'post_id', 'workflow_id', 'workflowId']
    .map((key) => String(data[key] || '').trim())
    .find(Boolean);
  if (direct) return direct;
  for (const key of ['channel', 'category', 'subject', 'post', 'workflow']) {
    const nested = String(recordInput(data[key]).id || recordInput(data[key]).workflowId || '').trim();
    if (nested) return nested;
  }
  return '';
}

export function actionReferenceId(runtime: AgentActionRuntime, value: string) {
  const raw = String(value || '').trim();
  if (raw && runtime.resultsById?.[raw]) return raw;
  const placeholder = raw.match(/^to_be_filled_from_([a-zA-Z0-9_-]+)$/);
  if (placeholder?.[1] && runtime.resultsById?.[placeholder[1]]) return placeholder[1];
  const match = raw.match(actionTokenPattern);
  const actionId = String(match?.[1] || '').trim();
  return actionId && runtime.resultsById?.[actionId] ? actionId : raw;
}

export function actionResultValue(runtime: AgentActionRuntime, input: any, actionKeys: string[], resultKeys: string[]) {
  for (const actionKey of actionKeys) {
    const actionId = actionReferenceId(runtime, optionalText(input, actionKey) || '');
    if (!actionId) continue;
    for (const resultKey of resultKeys) {
      const value = resultData(runtime, actionId, resultKey);
      const textValue = String(value || '').trim();
      if (textValue) return textValue;
      const nestedId = String(recordInput(value).id || '').trim();
      if (nestedId) return nestedId;
    }
    const direct = resolveActionReference(runtime, optionalText(input, actionKey) || '');
    if (direct && direct !== optionalText(input, actionKey)) return direct;
  }
  return '';
}

function readPath(source: any, path: string) {
  const keys = path
    .split('.')
    .map((key) => String(key || '').trim())
    .filter(Boolean);
  let value = source;
  for (const key of keys) {
    if (!value || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

export function resolveActionReference(runtime: AgentActionRuntime, value: string) {
  const raw = String(value || '').trim();
  const referencedActionId = actionReferenceId(runtime, raw);
  if (referencedActionId && referencedActionId !== raw) return resultId(runtime, referencedActionId) || raw;
  if (raw && runtime.resultsById?.[raw]) return resultId(runtime, raw) || raw;
  const match = raw.match(actionTokenPattern);
  if (!match) return raw;
  const actionId = String(match[1] || '').trim();
  const path = String(match[2] || '')
    .trim()
    .replace(/^output\./, '');
  const source = recordInput((runtime.resultsById as Record<string, unknown> | undefined)?.[actionId]);
  if (!Object.keys(source).length || !path) return raw;
  const resolved =
    readPath(source, path) ??
    readPath(source, `data.${path}`) ??
    readPath(source, `action_result.${path}`) ??
    readPath(source, `data.action_result.${path}`) ??
    readPath(source, path.replace(/^action_result\./, '')) ??
    readPath(source, `data.${path.replace(/^action_result\./, '')}`);
  const text = String(
    (resolved && typeof resolved === 'object' ? (resolved as Record<string, unknown>).id : resolved) || resultId(runtime, actionId),
  ).trim();
  return text || raw;
}

const treeNodes = (items: TreeNode[]): TreeNode[] => {
  const rows: TreeNode[] = [];
  for (const item of items) rows.push(item, ...treeNodes(item.children || []));
  return rows;
};

export async function resolveTreeNodeId(
  runtime: AgentActionRuntime,
  input: any,
  params: { idKey: string; label: string; nameKeys?: string[]; nodeType: string; preferScopedRoot?: boolean },
) {
  const body = recordInput(input);
  const rawId = resolveActionReference(runtime, optionalText(body, params.idKey) || '');
  const names = params.nameKeys || [];
  const rawName = names.map((key) => optionalText(body, key)).find(Boolean);
  const lookup = String(rawName || rawId || '').trim();
  if (!lookup) throw new BadRequestError(`${params.idKey} or ${params.label}_name is required.`);
  const scopeType = String(runtime.scopeType || runtime.context?.scope?.scope_type || '')
    .trim()
    .toUpperCase();
  const scopeId = String(runtime.scopeId || runtime.context?.scope?.scope_id || '').trim();
  if (rawId && uuidPattern.test(rawId) && rawId === scopeId && scopeType === params.nodeType) return rawId;
  if (rawId && uuidPattern.test(rawId) && (runtime.currentAction?.depends_on || []).some((actionId) => resultId(runtime, actionId) === rawId)) {
    return rawId;
  }
  if (rawId && uuidPattern.test(rawId) && !rawName) {
    const node = await resolveAccessibleTreeNode({
      userPermissionsId: runtime.userId,
      nodeId: rawId,
      nodeType: params.nodeType as ResourceType,
      organizationId: optionalText(body, 'organization_id') || null,
    });
    if (node) return rawId;
    throw new BadRequestError(`${params.label} "${rawId}" was not found or is not accessible.`);
  }
  const scopedRoot =
    scopeId &&
    (params.preferScopedRoot || params.nodeType !== RESOURCE_TYPES.channel) &&
    (scopeType === 'CHANNEL' || scopeType === 'CATEGORY' || scopeType === 'SUBJECT')
      ? { rootId: scopeId, rootType: scopeType }
      : {};
  const tree = await fetchUserTree(runtime.supabase, {
    userPermissionsId: runtime.userId,
    includeGlobal: false,
    organizationId: optionalText(body, 'organization_id') || null,
    rootId: rawId && uuidPattern.test(rawId) ? rawId : undefined,
    ...scopedRoot,
  } as any);
  const roots = optionalText(body, 'organization_id') ? tree.organization || [] : tree.user || [];
  const matches = treeNodes(roots).filter(
    (node) => node.nodeType === params.nodeType && (node.id === lookup || node.name === lookup || node.slug === lookup),
  );
  const uniqueMatches = Array.from(new Map(matches.map((node) => [node.id, node])).values());
  if (uniqueMatches.length === 1) return uniqueMatches[0].id;
  if (!rawName && rawId && uuidPattern.test(rawId)) throw new BadRequestError(`${params.label} "${rawId}" was not found or is not accessible.`);
  if (uniqueMatches.length > 1) throw new BadRequestError(`Multiple ${params.label}s matched "${lookup}". Use the ${params.idKey} field.`);
  throw new BadRequestError(`${params.label} "${lookup}" was not found or is not accessible.`);
}

export async function resolvePostId(
  runtime: AgentActionRuntime,
  input: any,
  params: { idKeys: string[]; titleKeys: string[]; actionKeys?: string[] },
) {
  const body = recordInput(input);
  const explicit = resolveActionReference(runtime, params.idKeys.map((key) => optionalText(body, key)).find(Boolean) || '');
  if (explicit && uuidPattern.test(explicit)) return explicit;
  const actionId = actionResultValue(runtime, body, params.actionKeys || [], ['post_id', 'post']);
  if (actionId && uuidPattern.test(actionId)) return actionId;
  const title = params.titleKeys.map((key) => optionalText(body, key)).find(Boolean) || (!uuidPattern.test(explicit) ? explicit : '');
  if (!title) throw new BadRequestError('post_id or post title is required.');
  const scopeType = String(runtime.scopeType || runtime.context?.scope?.scope_type || '')
    .trim()
    .toUpperCase();
  const scopeId = String(runtime.scopeId || runtime.context?.scope?.scope_id || '').trim();
  if (scopeId && (scopeType === 'CHANNEL' || scopeType === 'CATEGORY' || scopeType === 'SUBJECT')) {
    const tree = await fetchUserTree(runtime.supabase, {
      userPermissionsId: runtime.userId,
      organizationId: optionalText(body, 'organization_id') || null,
      rootId: scopeId,
      rootType: scopeType as any,
    });
    const scopedPosts = treeNodes([...(tree.user || []), ...(tree.organization || []), ...(tree.global || [])])
      .flatMap((node) => node.posts || [])
      .filter((post) => post.id === title || post.title === title);
    const scopedMatches = Array.from(new Map(scopedPosts.map((post) => [post.id, post])).values());
    if (scopedMatches.length === 1) return String(scopedMatches[0].id || '');
    if (scopedMatches.length > 1) throw new BadRequestError(`Multiple posts matched "${title}". Use the post id.`);
  }
  const rows = await Post.listIdRowsByTitle(title);
  if (rows.length === 1) return String(rows[0]?.id || '');
  if (rows.length > 1) throw new BadRequestError(`Multiple posts matched "${title}". Use the post id.`);
  throw new BadRequestError(`Post "${title}" was not found or is not accessible.`);
}
