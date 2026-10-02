// Thin wrapper over Confluence REST calls. `ConfluenceRequest` is injected so the
// same code runs with the user's permissions (@forge/bridge in the modal), with
// the app's permissions (@forge/api in the trigger) and against fakes in tests.

export type ConfluenceRequest = (
  path: string,
  init?: { method?: string; body?: string; headers?: Record<string, string> },
) => Promise<Response>;

export class ConfluenceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ConfluenceError";
  }
}

export class SortCancelled extends Error {
  constructor() {
    super("Sort cancelled");
    this.name = "SortCancelled";
  }
}

const RETRYABLE = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 8;
const MAX_BACKOFF_MS = 30_000;

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export const sleep: Sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new SortCancelled());
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new SortCancelled());
    }, { once: true });
  });

export function retryDelayMs(response: Response, attempt: number): number {
  const header = response.headers.get("Retry-After");
  const seconds = header === null ? NaN : Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_BACKOFF_MS);
  return Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
}

async function errorMessage(response: Response): Promise<string> {
  if (response.status === 401 || response.status === 403) {
    return "You need permission to edit these pages to sort them.";
  }
  try {
    const body = await response.json() as { message?: string; errors?: { title?: string }[] };
    const message = body.errors?.map((error) => error.title).filter(Boolean).join(" ") || body.message;
    if (message) return message;
  } catch {
    // Body was not JSON; fall through to the status line.
  }
  return `Confluence returned HTTP ${response.status}`;
}

export type RequestOptions = { signal?: AbortSignal; wait?: Sleep };

// Sends a request, waiting and retrying on rate limits and transient errors.
// 404 is returned to the caller, which decides whether it means "nothing yet".
export async function requestWithRetry(
  request: ConfluenceRequest,
  path: string,
  init: Parameters<ConfluenceRequest>[1] = {},
  options: RequestOptions & { allow404?: boolean } = {},
): Promise<Response> {
  const wait = options.wait ?? sleep;
  for (let attempt = 0; ; attempt++) {
    if (options.signal?.aborted) throw new SortCancelled();
    const response = await request(path, init);
    if (response.ok || (options.allow404 && response.status === 404)) return response;
    if (RETRYABLE.has(response.status) && attempt < MAX_RETRIES) {
      await wait(retryDelayMs(response, attempt), options.signal);
      continue;
    }
    throw new ConfluenceError(await errorMessage(response), response.status);
  }
}

export const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };

// Content ids are numeric; anything else must never reach a URL.
export function contentId(id: string): string {
  if (!/^\d+$/.test(id)) throw new Error(`Invalid content id: ${id}`);
  return id;
}
