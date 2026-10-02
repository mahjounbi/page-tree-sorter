import { contentId, requestWithRetry, type ConfluenceRequest, type RequestOptions } from "./http";
import { applyPlan, getRule, planSort } from "./confluence";

export type SortTarget =
  | { status: "skipped"; reason: "no-page" | "not-current" | "no-page-parent" | "no-rule" }
  | { status: "ready"; parentId: string };

export type KeepSortedResult =
  | { status: "skipped"; reason: "no-page" | "not-current" | "no-page-parent" | "no-rule" }
  | { status: "sorted"; parentId: string; moved: number };

// Cheap check run on every page event: does the page's parent carry a
// keep-sorted rule? Two reads, no moves.
export async function findSortTarget(request: ConfluenceRequest, pageId: string | undefined, options: RequestOptions = {}): Promise<SortTarget> {
  if (!pageId || !/^\d+$/.test(pageId)) return { status: "skipped", reason: "no-page" };
  const response = await requestWithRetry(request, `/wiki/api/v2/pages/${contentId(pageId)}`, { headers: { Accept: "application/json" } }, { ...options, allow404: true });
  if (response.status === 404) return { status: "skipped", reason: "no-page" };
  const page = await response.json() as { status?: string; parentId?: string | null; parentType?: string };
  if (page.status && page.status !== "current") return { status: "skipped", reason: "not-current" };
  if (!page.parentId || (page.parentType && page.parentType !== "page")) return { status: "skipped", reason: "no-page-parent" };
  const parentId = String(page.parentId);
  if (!(await getRule(request, parentId, options))) return { status: "skipped", reason: "no-rule" };
  return { status: "ready", parentId };
}

// Puts the children of `parentId` back in the order of its rule. The rule is
// read again because it may have been removed since the event was queued.
// A sorted tree plans zero moves, so running this twice is harmless.
export async function sortUnderRule(request: ConfluenceRequest, parentId: string, options: RequestOptions = {}): Promise<KeepSortedResult> {
  const rule = await getRule(request, parentId, options);
  if (!rule) return { status: "skipped", reason: "no-rule" };
  const plan = await planSort(request, parentId, rule.order, rule.locale, options);
  const moved = await applyPlan(request, plan.moves, options);
  return { status: "sorted", parentId, moved };
}

export async function keepSorted(request: ConfluenceRequest, pageId: string | undefined, options: RequestOptions = {}): Promise<KeepSortedResult> {
  const target = await findSortTarget(request, pageId, options);
  if (target.status === "skipped") return target;
  return sortUnderRule(request, target.parentId, options);
}
