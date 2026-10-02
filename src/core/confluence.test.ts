import { describe, expect, it } from "vitest";
import { applyPlan, deleteRule, getRule, listChildren, planSort, saveRule, sortAndSetRule } from "./confluence";
import { ConfluenceError, requestWithRetry, retryDelayMs, SortCancelled } from "./http";
import { findSortTarget, keepSorted, sortUnderRule } from "./keepSorted";
import { siteWithChildren } from "../testing/fakeConfluence";

const noWait = async () => {};

describe("sorting a real tree (CA2, CA3, CA5)", () => {
  it("sorts 600 children across several pages of results", async () => {
    const titles = Array.from({ length: 600 }, (_, i) => `Meeting ${600 - i}`);
    const site = siteWithChildren(titles, { pageSize: 250 });
    const plan = await planSort(site.request, "1", "title-asc", "en");
    expect(plan.children).toHaveLength(600);
    await applyPlan(site.request, plan.moves, { wait: noWait });
    expect(site.childOrder("1")).toEqual(Array.from({ length: 600 }, (_, i) => `Meeting ${i + 1}`));
    expect(site.calls.filter((call) => call.path.includes("direct-children"))).toHaveLength(3);
  });

  it("makes no move call when the tree is already sorted", async () => {
    const site = siteWithChildren(["A", "B", "C"]);
    const plan = await planSort(site.request, "1", "title-asc", "en");
    expect(await applyPlan(site.request, plan.moves)).toBe(0);
    expect(site.moveCalls()).toBe(0);
  });

  it("sorts by creation date, newest first", async () => {
    const site = siteWithChildren(["first", "second", "third"]);
    const plan = await planSort(site.request, "1", "created-desc", "en");
    await applyPlan(site.request, plan.moves);
    expect(site.childOrder("1")).toEqual(["third", "second", "first"]);
  });

  it("reads children in sidebar order", async () => {
    const site = siteWithChildren(["b", "a"]);
    expect((await listChildren(site.request, "1")).map((child) => child.title)).toEqual(["b", "a"]);
  });
});

describe("rate limits and errors (CA6, CA7)", () => {
  it("waits on 429 and retries the same move", async () => {
    let limited = false;
    const site = siteWithChildren(["b", "a"], {
      intercept: (method, path) => {
        if (method === "PUT" && path.includes("/move/") && !limited) {
          limited = true;
          return new Response("{}", { status: 429, headers: { "Retry-After": "2" } });
        }
      },
    });
    const waits: number[] = [];
    const plan = await planSort(site.request, "1", "title-asc", "en");
    await applyPlan(site.request, plan.moves, { wait: async (ms) => { waits.push(ms); } });
    expect(waits).toEqual([2000]);
    expect(site.childOrder("1")).toEqual(["a", "b"]);
  });

  it("explains a missing permission in plain words", async () => {
    const site = siteWithChildren(["b", "a"], { intercept: (method) => (method === "PUT" ? new Response("{}", { status: 403 }) : undefined) });
    const plan = await planSort(site.request, "1", "title-asc", "en");
    await expect(applyPlan(site.request, plan.moves)).rejects.toThrow("You need permission to edit these pages to sort them.");
  });

  it("gives up after repeated rate limits", async () => {
    const request = async () => new Response("{}", { status: 429 });
    await expect(requestWithRetry(request, "/x", {}, { wait: noWait })).rejects.toBeInstanceOf(ConfluenceError);
  });

  it("uses Retry-After, else capped exponential backoff", () => {
    expect(retryDelayMs(new Response("", { status: 429, headers: { "Retry-After": "3" } }), 0)).toBe(3000);
    expect(retryDelayMs(new Response("", { status: 429 }), 2)).toBe(4000);
    expect(retryDelayMs(new Response("", { status: 429 }), 10)).toBe(30_000);
  });

  it("stops when cancelled", async () => {
    const site = siteWithChildren(["e", "d", "c", "b", "a"]);
    const plan = await planSort(site.request, "1", "title-asc", "en");
    const controller = new AbortController();
    const run = applyPlan(site.request, plan.moves, { signal: controller.signal, onProgress: (done) => { if (done === 2) controller.abort(); } });
    await expect(run).rejects.toBeInstanceOf(SortCancelled);
    expect(site.moveCalls()).toBe(2);
  });

  it("refuses non-numeric ids before building a URL", async () => {
    const site = siteWithChildren([]);
    await expect(listChildren(site.request, "1/../../admin")).rejects.toThrow("Invalid content id");
  });
});

describe("keep-sorted rule (CA8, CA9)", () => {
  it("saves, updates, reads and deletes the rule", async () => {
    const site = siteWithChildren([]);
    expect(await getRule(site.request, "1")).toBeNull();
    await saveRule(site.request, "1", { order: "title-asc", locale: "fr-FR" });
    await saveRule(site.request, "1", { order: "created-desc", locale: "fr-FR" });
    expect(await getRule(site.request, "1")).toEqual({ order: "created-desc", locale: "fr-FR" });
    await deleteRule(site.request, "1");
    expect(await getRule(site.request, "1")).toBeNull();
  });

  it("puts a new page in place under a parent with a rule", async () => {
    const site = siteWithChildren(["Alpha", "Charlie"]);
    await saveRule(site.request, "1", { order: "title-asc", locale: "en" });
    site.add({ id: "200", title: "Bravo", type: "page", parentId: "1", createdAt: "2026-10-02T10:00:00Z" });
    expect(await keepSorted(site.request, "200")).toEqual({ status: "sorted", parentId: "1", moved: 1 });
    expect(site.childOrder("1")).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("re-sorts after a rename", async () => {
    const site = siteWithChildren(["Alpha", "Bravo", "Charlie"]);
    await saveRule(site.request, "1", { order: "title-asc", locale: "en" });
    site.rename("101", "Zulu");
    await keepSorted(site.request, "101");
    expect(site.childOrder("1")).toEqual(["Bravo", "Charlie", "Zulu"]);
  });

  it("does nothing without a rule", async () => {
    const site = siteWithChildren(["b", "a"]);
    expect(await keepSorted(site.request, "101")).toEqual({ status: "skipped", reason: "no-rule" });
    expect(site.moveCalls()).toBe(0);
  });

  it("does not loop: the events from its own moves change nothing", async () => {
    const site = siteWithChildren(["d", "c", "b", "a"]);
    await saveRule(site.request, "1", { order: "title-asc", locale: "en" });
    await keepSorted(site.request, "101");
    const movesAfterFirstRun = site.moveCalls();
    for (const id of ["101", "102", "103", "104"]) {
      expect(await keepSorted(site.request, id)).toEqual({ status: "sorted", parentId: "1", moved: 0 });
    }
    expect(site.moveCalls()).toBe(movesAfterFirstRun);
  });

  it("checks for a rule without moving anything, then sorts in the worker", async () => {
    const site = siteWithChildren(["b", "a"]);
    await saveRule(site.request, "1", { order: "title-asc", locale: "en" });
    expect(await findSortTarget(site.request, "101")).toEqual({ status: "ready", parentId: "1" });
    expect(site.moveCalls()).toBe(0);
    expect(await sortUnderRule(site.request, "1")).toEqual({ status: "sorted", parentId: "1", moved: 1 });
  });

  it("does nothing in the worker if the rule was removed after the event", async () => {
    const site = siteWithChildren(["b", "a"]);
    expect(await sortUnderRule(site.request, "1")).toEqual({ status: "skipped", reason: "no-rule" });
  });

  it("pauses the old rule while the user's sort moves pages, then saves the new one", async () => {
    let ruleDuringMoves: unknown = "unset";
    const site = siteWithChildren(["a", "b", "c"], {
      intercept: (method, path) => {
        if (method === "PUT" && path.includes("/move/") && ruleDuringMoves === "unset") {
          // Record what a queued run would read at the time of the first move.
          ruleDuringMoves = "pending";
          void getRule(site.request, "1").then((rule) => { ruleDuringMoves = rule; });
        }
        return undefined;
      },
    });
    await saveRule(site.request, "1", { order: "title-asc", locale: "en" });
    const plan = await planSort(site.request, "1", "title-desc", "en");
    await sortAndSetRule(site.request, "1", plan.moves, { previous: { order: "title-asc", locale: "en" }, next: { order: "title-desc", locale: "en" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ruleDuringMoves).toBeNull();
    expect(await getRule(site.request, "1")).toEqual({ order: "title-desc", locale: "en" });
    expect(await keepSorted(site.request, "101")).toEqual({ status: "sorted", parentId: "1", moved: 0 });
    expect(site.childOrder("1")).toEqual(["c", "b", "a"]);
  });

  it("puts the previous rule back if the sort stops", async () => {
    const site = siteWithChildren(["a", "b"], { intercept: (method, path) => (method === "PUT" && path.includes("/move/") ? new Response("{}", { status: 403 }) : undefined) });
    await saveRule(site.request, "1", { order: "title-asc", locale: "en" });
    const plan = await planSort(site.request, "1", "title-desc", "en");
    await expect(sortAndSetRule(site.request, "1", plan.moves, { previous: { order: "title-asc", locale: "en" }, next: null })).rejects.toThrow();
    expect(await getRule(site.request, "1")).toEqual({ order: "title-asc", locale: "en" });
  });

  it("skips top-level pages and unknown ids", async () => {
    const site = siteWithChildren(["a"]);
    expect(await keepSorted(site.request, "1")).toEqual({ status: "skipped", reason: "no-page-parent" });
    expect(await keepSorted(site.request, "999")).toEqual({ status: "skipped", reason: "no-page" });
    expect(await keepSorted(site.request, undefined)).toEqual({ status: "skipped", reason: "no-page" });
  });
});
