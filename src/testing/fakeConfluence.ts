// In-memory Confluence site used by unit tests and by the local UI mock.
// It implements only the endpoints the app calls, with Confluence's semantics.
import type { ConfluenceRequest } from "../core/http";

export type FakeContent = { id: string; title: string; type: string; parentId: string | null; createdAt: string; status?: string };

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

export type FakeOptions = {
  pageSize?: number;
  // Returns a response to send instead of the real one (rate limits, errors).
  intercept?: (method: string, path: string, callIndex: number) => Response | undefined;
};

export function fakeConfluence(contents: FakeContent[], options: FakeOptions = {}) {
  const byId = new Map(contents.map((content) => [content.id, { status: "current", ...content }]));
  // Sidebar order per parent.
  const order = new Map<string, string[]>();
  for (const content of contents) {
    if (!content.parentId) continue;
    order.set(content.parentId, [...(order.get(content.parentId) ?? []), content.id]);
  }
  const properties = new Map<string, { id: string; key: string; value: unknown; version: { number: number } }>();
  const calls: { method: string; path: string }[] = [];
  let nextPropertyId = 900_000;

  const request: ConfluenceRequest = async (path, init = {}) => {
    const method = init.method ?? "GET";
    calls.push({ method, path });
    const intercepted = options.intercept?.(method, path, calls.length - 1);
    if (intercepted) return intercepted;
    const url = new URL(path, "https://site.atlassian.net");
    let match: RegExpMatchArray | null;

    if ((match = url.pathname.match(/^\/wiki\/api\/v2\/pages\/(\d+)\/direct-children$/))) {
      const ids = order.get(match[1]) ?? [];
      const limit = Number(url.searchParams.get("limit") ?? 25);
      const pageSize = Math.min(limit, options.pageSize ?? limit);
      const start = Number(url.searchParams.get("cursor") ?? 0);
      const slice = ids.slice(start, start + pageSize);
      const results = slice.map((id, index) => {
        const content = byId.get(id)!;
        return { id, title: content.title, type: content.type, status: content.status, childPosition: (start + index) * 10 };
      });
      const next = start + pageSize < ids.length ? `/api/v2/pages/${match[1]}/direct-children?limit=${limit}&cursor=${start + pageSize}` : undefined;
      return json({ results, _links: next ? { next } : {} });
    }

    if (url.pathname === "/wiki/api/v2/pages" && method === "GET") {
      const ids = (url.searchParams.get("id") ?? "").split(",");
      return json({ results: ids.map((id) => byId.get(id)).filter((c) => c?.type === "page").map((c) => ({ id: c!.id, title: c!.title, createdAt: c!.createdAt })) });
    }

    if ((match = url.pathname.match(/^\/wiki\/api\/v2\/(folders|whiteboards|databases|embeds)\/(\d+)$/))) {
      const content = byId.get(match[2]);
      return content ? json({ id: content.id, createdAt: content.createdAt }) : json({}, 404);
    }

    if ((match = url.pathname.match(/^\/wiki\/api\/v2\/pages\/(\d+)$/))) {
      const content = byId.get(match[1]);
      if (!content || content.type !== "page") return json({}, 404);
      const parent = content.parentId ? byId.get(content.parentId) : undefined;
      return json({ id: content.id, title: content.title, status: content.status, parentId: content.parentId, parentType: parent?.type ?? null });
    }

    if ((match = url.pathname.match(/^\/wiki\/api\/v2\/pages\/(\d+)\/properties(?:\/(\d+))?$/))) {
      const [, pageId, propertyId] = match;
      const stored = properties.get(pageId);
      if (method === "GET") {
        const key = url.searchParams.get("key");
        return json({ results: stored && (!key || key === stored.key) ? [stored] : [] });
      }
      if (method === "POST") {
        const body = JSON.parse(init.body ?? "{}");
        const property = { id: String(nextPropertyId++), key: body.key, value: body.value, version: { number: 1 } };
        properties.set(pageId, property);
        return json(property);
      }
      if (!stored || stored.id !== propertyId) return json({}, 404);
      if (method === "PUT") {
        const body = JSON.parse(init.body ?? "{}");
        if (body.version?.number !== stored.version.number + 1) return json({ message: "Version conflict" }, 409);
        const property = { ...stored, value: body.value, version: { number: body.version.number } };
        properties.set(pageId, property);
        return json(property);
      }
      if (method === "DELETE") {
        properties.delete(pageId);
        return json(null, 204);
      }
    }

    if ((match = url.pathname.match(/^\/wiki\/rest\/api\/content\/(\d+)\/move\/(before|after|append)\/(\d+)$/)) && method === "PUT") {
      const [, id, position, targetId] = match;
      const content = byId.get(id), target = byId.get(targetId);
      if (!content || !target) return json({ message: "Not found" }, 404);
      const parentId = position === "append" ? targetId : target.parentId!;
      if (content.parentId) order.set(content.parentId, order.get(content.parentId)!.filter((other) => other !== id));
      const siblings = [...(order.get(parentId) ?? [])];
      const at = siblings.indexOf(targetId);
      if (position === "append") siblings.push(id);
      else siblings.splice(position === "before" ? at : at + 1, 0, id);
      order.set(parentId, siblings);
      content.parentId = parentId;
      return json({ pageId: id });
    }

    return json({ message: `Unexpected ${method} ${path}` }, 500);
  };

  return {
    request,
    calls,
    childOrder: (parentId: string) => (order.get(parentId) ?? []).map((id) => byId.get(id)!.title),
    moveCalls: () => calls.filter((call) => call.path.includes("/move/")).length,
    add(content: FakeContent) {
      byId.set(content.id, { status: "current", ...content });
      if (content.parentId) order.set(content.parentId, [...(order.get(content.parentId) ?? []), content.id]);
    },
    rename(id: string, title: string) {
      byId.get(id)!.title = title;
    },
  };
}

// A parent page "1" with the given child titles (ids 101, 102, ...).
export function siteWithChildren(titles: string[], options: FakeOptions = {}) {
  const contents: FakeContent[] = [{ id: "1", title: "Handbook", type: "page", parentId: null, createdAt: "2026-01-01T00:00:00Z" }];
  titles.forEach((title, index) => contents.push({
    id: String(101 + index),
    title,
    type: "page",
    parentId: "1",
    createdAt: new Date(Date.UTC(2026, 0, 2) + index * 86_400_000).toISOString(),
  }));
  return fakeConfluence(contents, options);
}
