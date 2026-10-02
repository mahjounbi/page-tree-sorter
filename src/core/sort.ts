export type SortOrder = "title-asc" | "title-desc" | "created-desc" | "created-asc";

export const SORT_ORDERS: SortOrder[] = ["title-asc", "title-desc", "created-desc", "created-asc"];

export type Child = { id: string; title: string; type: string; createdAt?: string };

export type Move = { id: string; position: "before" | "after"; targetId: string };

export function isSortOrder(value: unknown): value is SortOrder {
  return typeof value === "string" && (SORT_ORDERS as string[]).includes(value);
}

export function needsDates(order: SortOrder): boolean {
  return order === "created-desc" || order === "created-asc";
}

// Natural order: "Page 2" before "Page 10"; case and accents ignored.
// Atlassian sends locales as "fr_FR"; Intl expects "fr-FR".
export function normalizeLocale(locale: string | undefined): string {
  return (locale || "en").replace(/_/g, "-");
}

function titleComparer(locale: string): (a: string, b: string) => number {
  let collator: Intl.Collator;
  try {
    collator = new Intl.Collator(normalizeLocale(locale), { numeric: true, sensitivity: "base" });
  } catch {
    collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  }
  return (a, b) => collator.compare(a, b);
}

function time(child: Child): number {
  const value = child.createdAt ? Date.parse(child.createdAt) : NaN;
  return Number.isNaN(value) ? Number.POSITIVE_INFINITY : value;
}

// Returns the children in the requested order. Ties keep their current order,
// so re-sorting a sorted tree never moves anything.
export function sortChildren(children: Child[], order: SortOrder, locale = "en"): Child[] {
  const byTitle = titleComparer(locale);
  const compare: Record<SortOrder, (a: Child, b: Child) => number> = {
    "title-asc": (a, b) => byTitle(a.title, b.title),
    "title-desc": (a, b) => byTitle(b.title, a.title),
    // Items without a date go last in both directions.
    "created-asc": (a, b) => time(a) - time(b) || 0,
    "created-desc": (a, b) => {
      const ta = time(a), tb = time(b);
      if (ta === tb) return 0;
      if (ta === Number.POSITIVE_INFINITY) return 1;
      if (tb === Number.POSITIVE_INFINITY) return -1;
      return tb - ta;
    },
  };
  return children
    .map((child, index) => ({ child, index }))
    .sort((a, b) => compare[order](a.child, b.child) || a.index - b.index)
    .map(({ child }) => child);
}

// Indexes (into `values`) of one longest strictly increasing subsequence.
function longestIncreasing(values: number[]): Set<number> {
  const tails: number[] = [];
  const previous = new Array<number>(values.length).fill(-1);
  for (let i = 0; i < values.length; i++) {
    let low = 0, high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (values[tails[mid]] < values[i]) low = mid + 1;
      else high = mid;
    }
    if (low > 0) previous[i] = tails[low - 1];
    tails[low] = i;
  }
  const kept = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1] : -1; i !== -1; i = previous[i]) kept.add(i);
  return kept;
}

// Plans the fewest moves that turn `current` into `target` (same ids).
// Pages already in the right relative order (the longest increasing run) stay
// put; every other page is placed right after its predecessor in the target
// order, left to right, or before the first page when it comes first.
export function planMoves(current: string[], target: string[]): Move[] {
  const rank = new Map(target.map((id, index) => [id, index]));
  if (rank.size !== current.length || current.some((id) => !rank.has(id))) {
    throw new Error("Current and target orders must contain the same pages");
  }
  const keptIndexes = longestIncreasing(current.map((id) => rank.get(id)!));
  const kept = new Set([...keptIndexes].map((index) => current[index]));
  const moves: Move[] = [];
  target.forEach((id, index) => {
    if (kept.has(id)) return;
    if (index === 0) {
      const first = current[0] === id ? current[1] : current[0];
      moves.push({ id, position: "before", targetId: first });
    } else {
      moves.push({ id, position: "after", targetId: target[index - 1] });
    }
  });
  return moves;
}

// Applies moves to an id list, exactly as Confluence would. Used by tests and
// by the local mock to check plans.
export function applyMovesLocally(order: string[], moves: Move[]): string[] {
  const result = [...order];
  for (const move of moves) {
    result.splice(result.indexOf(move.id), 1);
    const at = result.indexOf(move.targetId);
    result.splice(move.position === "before" ? at : at + 1, 0, move.id);
  }
  return result;
}
