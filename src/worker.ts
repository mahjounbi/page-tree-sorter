import Resolver from "@forge/resolver";
import { sortUnderRule } from "./core/keepSorted";
import { asApp } from "./forge";

const resolver = new Resolver();

resolver.define("sort-parent", async ({ payload }) => {
  const parentId = String((payload as { parentId?: unknown }).parentId ?? "");
  if (!/^\d+$/.test(parentId)) return;
  const result = await sortUnderRule(asApp, parentId);
  if (result.status === "sorted" && result.moved > 0) console.log(`Re-sorted children of ${parentId}: ${result.moved} moved`);
});

export const handler = resolver.getDefinitions();
