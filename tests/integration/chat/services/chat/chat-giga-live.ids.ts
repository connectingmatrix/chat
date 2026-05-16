export type CreatedIds = {
  categories: Set<string>;
  channels: Set<string>;
  chats: Set<string>;
  posts: Set<string>;
  subjects: Set<string>;
  workflows: Set<string>;
};

export function createdIds(): CreatedIds {
  return {
    categories: new Set<string>(),
    channels: new Set<string>(),
    chats: new Set<string>(),
    posts: new Set<string>(),
    subjects: new Set<string>(),
    workflows: new Set<string>(),
  };
}

export function setList(values: Set<string>) {
  return Array.from(values).filter(Boolean);
}

export function mergeCreatedIds(target: CreatedIds, source: CreatedIds): void {
  for (const id of source.channels) target.channels.add(id);
  for (const id of source.categories) target.categories.add(id);
  for (const id of source.posts) target.posts.add(id);
  for (const id of source.subjects) target.subjects.add(id);
  for (const id of source.workflows) target.workflows.add(id);
  for (const id of source.chats) target.chats.add(id);
}

export function collectAgentIds(agent: any, ids: CreatedIds): void {
  for (const result of agent?.action_results || []) {
    collectDataIds(result?.data || {}, ids);
  }
}

export function collectDataIds(data: any, ids: CreatedIds): void {
  if (data.channel_id) ids.channels.add(String(data.channel_id));
  if (data.category_id) ids.categories.add(String(data.category_id));
  if (data.post_id) ids.posts.add(String(data.post_id));
  if (data.subject_id) ids.subjects.add(String(data.subject_id));
  if (data.workflow_id) ids.workflows.add(String(data.workflow_id));
  if (data.post?.id) ids.posts.add(String(data.post.id));
  if (data.workflow?.id) ids.workflows.add(String(data.workflow.id));

  for (const entry of data.nested || []) {
    if (entry?.category_id) ids.categories.add(String(entry.category_id));
    if (entry?.channel_id) ids.channels.add(String(entry.channel_id));
    for (const subject of entry?.subjects || []) {
      if (subject?.id) ids.subjects.add(String(subject.id));
    }
  }
}

export function treeIds(tree: any) {
  const ids = new Set<string>();
  const stack: any[] = [];
  for (const node of tree?.user || []) stack.push(node);
  for (const node of tree?.organization || []) stack.push(node);
  for (const node of tree?.global || []) stack.push(node);

  while (stack.length) {
    const node = stack.pop();
    if (!node?.id) continue;
    ids.add(String(node.id));
    for (const child of node.children || []) stack.push(child);
  }

  return ids;
}

export function hasNestedSubjects(action: any) {
  for (const category of action?.input?.categories || []) {
    if ((category?.subjects || []).length) return true;
    for (const child of category?.categories || []) {
      if ((child?.subjects || []).length) return true;
    }
  }
  return false;
}
