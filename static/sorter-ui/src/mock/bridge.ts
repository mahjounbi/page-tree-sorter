// Local stand-in for @forge/bridge, used only by `npm run dev:mock` and the
// browser QA run. It simulates a Confluence page with 60 child pages.
import { fakeConfluence, type FakeContent } from "../../../../src/testing/fakeConfluence";
import { saveRule } from "../../../../src/core/confluence";

const params = new URLSearchParams(location.search);
const scenario = params.get("scenario") ?? "default";

function contents(): FakeContent[] {
  const root: FakeContent = { id: "1", title: "Release notes", type: "page", parentId: null, createdAt: "2025-01-01T00:00:00Z" };
  if (scenario === "empty") return [root];
  const titles = scenario === "sorted" || scenario === "rule"
    ? ["Archive", "Release 1.1", "Release 1.2", "Release 1.10"]
    : [
        ...Array.from({ length: 24 }, (_, i) => `Release 1.${(i * 7) % 24 + 1}`),
        "Upgrade guide", "Known issues", "Écran de connexion", "API changes", "archive 2024", "Beta program",
        ...Array.from({ length: 30 }, (_, i) => `Meeting notes 2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i * 3) % 28 + 1).padStart(2, "0")}`),
      ];
  return [
    root,
    ...titles.map((title, index) => ({
      id: String(100 + index),
      title,
      type: index === 28 ? "folder" : "page",
      parentId: "1",
      createdAt: new Date(Date.UTC(2025, 0, 1) + ((index * 37) % 60) * 86_400_000).toISOString(),
    })),
  ];
}

let moveCount = 0;
const site = fakeConfluence(contents(), {
  intercept: (method, path) => {
    if (scenario === "forbidden" && method === "PUT") return new Response("{}", { status: 403 });
    if (method === "PUT" && path.includes("/move/") && ++moveCount % 15 === 0) {
      return new Response("{}", { status: 429, headers: { "Retry-After": "1" } });
    }
    return undefined;
  },
});

if (scenario === "rule") await saveRule(site.request, "1", { order: "title-asc", locale: "en-US" });

const latency = () => new Promise((resolve) => setTimeout(resolve, 60 + Math.random() * 60));

export async function requestConfluence(path: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) {
  await latency();
  return site.request(path, init);
}

export const view = {
  theme: { enable: async () => {} },
  // ?locale=fr-FR shows the French UI.
  getContext: async () => ({ locale: new URLSearchParams(location.search).get("locale") ?? "en-US", extension: { content: { id: "1", title: "Release notes" } } }),
  close: async () => { document.body.dataset.closed = "true"; },
};

export const router = {
  reload: async () => { document.body.dataset.closed = "reloaded"; },
};

// Lets the QA script read the real order after a sort.
(window as unknown as { __mockSite: typeof site }).__mockSite = site;
