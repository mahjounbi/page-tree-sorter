# Page Tree Sorter for Confluence

Forge app for Confluence Cloud: sort the child pages of any page by title (natural order) or creation date, and keep them sorted when pages are created, moved or renamed. Built to qualify for **Runs on Atlassian**: no backend, no remotes, no external domains (see ADR-002).

## How it works

- `confluence:contentAction` "Sort child pages" opens a Custom UI modal (`static/sorter-ui`, React 19 + Atlaskit). It reads the children with the user's own permissions (`requestConfluence`), shows a preview of the new order and moves only the pages that need it.
- The "Keep sorted automatically" rule is a content property (`page-tree-sorter.rule`) on the parent page.
- A trigger on `avi:confluence:created|moved|updated:page` (ignoring the app's own events) runs `src/trigger.ts`: if the page's parent carries a rule, it queues the parent on the `sort-parent` Forge queue. `src/worker.ts` consumes it (one run per parent at a time, 900 s limit) and puts the siblings back in order with the app's permissions.
- `src/core` holds the shared engine: natural sort, minimal move plan (longest increasing subsequence), REST calls with rate-limit retries. A sorted tree plans zero moves, so the app's own move events never loop.

## Develop

```bash
npm install && npm --prefix static/sorter-ui install
npm test            # unit tests (Vitest) on a simulated Confluence site
npm run typecheck
npm run dev:mock    # the modal against a simulated page with 60 children
npm run build       # production bundle in static/sorter-ui/dist
```

## Deploy (needs a Forge login)

```bash
export FORGE_EMAIL=... FORGE_API_TOKEN=...
npx forge register            # once, replaces app.id in manifest.yml
npm run build
npx forge deploy --environment development
npx forge install --site <site>.atlassian.net --product confluence --environment development
npx forge eligibility --environment development   # must report Runs on Atlassian
```
