import { contentId, JSON_HEADERS, requestWithRetry, SortCancelled, type ConfluenceRequest, type RequestOptions } from "./http";
import { isSortOrder, needsDates, planMoves, sortChildren, type Child, type Move, type SortOrder } from "./sort";

type ChildrenPage = {
  results?: { id: string; title?: string; type?: string; status?: string; childPosition?: number }[];
  _links?: { next?: string };
};

const API = "/wiki/api/v2";

// Strips the site prefix from `_links.next` so the cursor URL can be requested again.
function nextPath(next: string | undefined): string | undefined {
  if (!next) return undefined;
  const path = next.replace(/^https?:\/\/[^/]+/, "");
  return path.startsWith("/wiki/") ? path : `/wiki${path}`;
}

// Direct children (pages, folders, whiteboards, databases) in sidebar order.
export async function listChildren(request: ConfluenceRequest, parentId: string, options: RequestOptions = {}): Promise<Child[]> {
  const children: { child: Child; position: number; index: number }[] = [];
  let path: string | undefined = `${API}/pages/${contentId(parentId)}/direct-children?limit=250`;
  while (path) {
    const response = await requestWithRetry(request, path, { headers: { Accept: "application/json" } }, options);
    const page = await response.json() as ChildrenPage;
    for (const item of page.results ?? []) {
      if (item.status && item.status !== "current") continue;
      children.push({
        child: { id: String(item.id), title: item.title ?? "", type: item.type ?? "page" },
        position: item.childPosition ?? Number.MAX_SAFE_INTEGER,
        index: children.length,
      });
    }
    path = nextPath(page._links?.next);
  }
  return children.sort((a, b) => a.position - b.position || a.index - b.index).map(({ child }) => child);
}

const SINGLE_ENDPOINT: Record<string, string> = { folder: "folders", whiteboard: "whiteboards", database: "databases", embed: "embeds" };

// Adds creation dates: pages in batches of 250, other content one by one.
export async function withCreatedDates(request: ConfluenceRequest, children: Child[], options: RequestOptions = {}): Promise<Child[]> {
  const dates = new Map<string, string>();
  const pageIds = children.filter((child) => child.type === "page").map((child) => contentId(child.id));
  for (let start = 0; start < pageIds.length; start += 250) {
    const ids = pageIds.slice(start, start + 250).join(",");
    const response = await requestWithRetry(request, `${API}/pages?id=${ids}&limit=250`, { headers: { Accept: "application/json" } }, options);
    const body = await response.json() as { results?: { id: string; createdAt?: string }[] };
    for (const page of body.results ?? []) if (page.createdAt) dates.set(String(page.id), page.createdAt);
  }
  for (const child of children) {
    const endpoint = SINGLE_ENDPOINT[child.type];
    if (!endpoint) continue;
    const response = await requestWithRetry(request, `${API}/${endpoint}/${contentId(child.id)}`, { headers: { Accept: "application/json" } }, { ...options, allow404: true });
    if (response.status === 404) continue;
    const body = await response.json() as { createdAt?: string };
    if (body.createdAt) dates.set(child.id, body.createdAt);
  }
  return children.map((child) => ({ ...child, createdAt: dates.get(child.id) }));
}

export async function movePage(request: ConfluenceRequest, move: Move, options: RequestOptions = {}): Promise<void> {
  const path = `/wiki/rest/api/content/${contentId(move.id)}/move/${move.position}/${contentId(move.targetId)}`;
  await requestWithRetry(request, path, { method: "PUT", headers: { Accept: "application/json" } }, options);
}

export type SortPlan = { children: Child[]; sorted: Child[]; moves: Move[] };

export async function planSort(
  request: ConfluenceRequest,
  parentId: string,
  order: SortOrder,
  locale: string,
  options: RequestOptions = {},
): Promise<SortPlan> {
  let children = await listChildren(request, parentId, options);
  if (needsDates(order)) children = await withCreatedDates(request, children, options);
  const sorted = sortChildren(children, order, locale);
  const moves = planMoves(children.map((child) => child.id), sorted.map((child) => child.id));
  return { children, sorted, moves };
}

export async function applyPlan(
  request: ConfluenceRequest,
  moves: Move[],
  options: RequestOptions & { onProgress?: (done: number) => void } = {},
): Promise<number> {
  let done = 0;
  for (const move of moves) {
    if (options.signal?.aborted) throw new SortCancelled();
    await movePage(request, move, options);
    done++;
    options.onProgress?.(done);
  }
  return done;
}

// --- Keep-sorted rule, stored as a content property on the parent page ---

export const RULE_KEY = "page-tree-sorter.rule";

export type Rule = { order: SortOrder; locale: string };

type Property = { id: string; key: string; value: unknown; version?: { number: number } };

async function findRuleProperty(request: ConfluenceRequest, pageId: string, options: RequestOptions): Promise<Property | undefined> {
  const response = await requestWithRetry(
    request,
    `${API}/pages/${contentId(pageId)}/properties?key=${encodeURIComponent(RULE_KEY)}`,
    { headers: { Accept: "application/json" } },
    { ...options, allow404: true },
  );
  if (response.status === 404) return undefined;
  const body = await response.json() as { results?: Property[] };
  return body.results?.[0];
}

export async function getRule(request: ConfluenceRequest, pageId: string, options: RequestOptions = {}): Promise<Rule | null> {
  const value = (await findRuleProperty(request, pageId, options))?.value as Partial<Rule> | undefined;
  if (!value || !isSortOrder(value.order)) return null;
  return { order: value.order, locale: typeof value.locale === "string" ? value.locale : "en" };
}

export async function saveRule(request: ConfluenceRequest, pageId: string, rule: Rule, options: RequestOptions = {}): Promise<void> {
  const existing = await findRuleProperty(request, pageId, options);
  const base = `${API}/pages/${contentId(pageId)}/properties`;
  if (existing) {
    await requestWithRetry(request, `${base}/${contentId(existing.id)}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ key: RULE_KEY, value: rule, version: { number: (existing.version?.number ?? 1) + 1 } }),
    }, options);
  } else {
    await requestWithRetry(request, base, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ key: RULE_KEY, value: rule }) }, options);
  }
}

export async function deleteRule(request: ConfluenceRequest, pageId: string, options: RequestOptions = {}): Promise<void> {
  const existing = await findRuleProperty(request, pageId, options);
  if (!existing) return;
  await requestWithRetry(request, `${API}/pages/${contentId(pageId)}/properties/${contentId(existing.id)}`, { method: "DELETE" }, { ...options, allow404: true });
}

// Sorts by hand (as the user) and then sets the keep-sorted rule. The moves are
// made as the user, so the trigger sees them: the old rule is paused first, so
// no queued run re-sorts the pages by the old order while we move them. If the
// sort stops, the previous rule is put back.
export async function sortAndSetRule(
  request: ConfluenceRequest,
  pageId: string,
  moves: Move[],
  rules: { previous: Rule | null; next: Rule | null },
  options: RequestOptions & { onProgress?: (done: number) => void } = {},
): Promise<number> {
  if (rules.previous) await deleteRule(request, pageId, options);
  try {
    const moved = await applyPlan(request, moves, options);
    if (rules.next) await saveRule(request, pageId, rules.next, options);
    return moved;
  } catch (error) {
    if (rules.previous) await saveRule(request, pageId, rules.previous).catch(() => {});
    throw error;
  }
}
