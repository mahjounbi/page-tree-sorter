import { Queue } from "@forge/events";
import { findSortTarget } from "./core/keepSorted";
import { asApp } from "./forge";

export const SORT_QUEUE = "sort-parent";
const queue = new Queue({ key: SORT_QUEUE });

type PageEvent = { eventType?: string; content?: { id?: string | number } };

// Runs on every page created, moved or updated, including the app's own moves
// (Confluence triggers can't ignore them; the re-run plans zero moves). It only checks for a rule; the sorting itself
// runs in the queue consumer, which has a longer time limit and handles one
// parent at a time.
export async function onPageChanged(event: PageEvent): Promise<void> {
  const pageId = event.content?.id === undefined ? undefined : String(event.content.id);
  const target = await findSortTarget(asApp, pageId);
  if (target.status !== "ready") return;
  await queue.push({
    body: { parentId: target.parentId },
    // Bursts of new pages under one parent are sorted once, one run at a time.
    delayInSeconds: 3,
    concurrency: { key: `parent-${target.parentId}`, limit: 1 },
  });
}
