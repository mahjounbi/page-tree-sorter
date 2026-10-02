import api, { assumeTrustedRoute } from "@forge/api";
import type { ConfluenceRequest } from "./core/http";

// Paths are built from numeric content ids only (see contentId in core/http).
export const asApp: ConfluenceRequest = (path, init) =>
  api.asApp().requestConfluence(assumeTrustedRoute(path), init) as unknown as Promise<Response>;
