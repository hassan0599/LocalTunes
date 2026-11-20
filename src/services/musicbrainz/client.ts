/**
 * MusicBrainz web service client (spec 6.3).
 *
 * - One serial queue: requests never overlap and start at least `spacingMs` apart
 *   (MusicBrainz allows ~1 request/second per client).
 * - 503 (and 429) mean "slow down": retry with exponential backoff.
 * - The descriptive User-Agent MusicBrainz requires is sent on every request.
 *
 * Network and timers are injectable so the throttling logic is unit-tested.
 */
import { MUSICBRAINZ_USER_AGENT } from '@/config';

export const MB_BASE = 'https://musicbrainz.org/ws/2/';

export class MbError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'MbError';
  }
}

export class MbNotFoundError extends MbError {
  constructor(path: string) {
    super(`Not found: ${path}`, 404);
    this.name = 'MbNotFoundError';
  }
}

export interface ClientDeps {
  fetch: (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const defaultDeps: ClientDeps = {
  fetch: (url, init) => fetch(url, init),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
};

export interface ClientOptions {
  userAgent?: string;
  spacingMs?: number;
  maxRetries?: number;
  timeoutMs?: number;
}

type Params = Record<string, string | number | undefined>;

export class MusicBrainzClient {
  private queue: Promise<unknown> = Promise.resolve();
  private lastStart = -Infinity;
  private readonly userAgent: string;
  private readonly spacingMs: number;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  constructor(
    opts: ClientOptions = {},
    private readonly deps: ClientDeps = defaultDeps,
  ) {
    this.userAgent = opts.userAgent ?? MUSICBRAINZ_USER_AGENT;
    this.spacingMs = opts.spacingMs ?? 1100;
    this.maxRetries = opts.maxRetries ?? 4;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  /** GET `path` (e.g. "artist/<mbid>") with query params; `fmt=json` is added. */
  get<T>(path: string, params: Params = {}): Promise<T> {
    const url = buildUrl(path, params);
    const run = this.queue.then(() => this.execute<T>(path, url));
    // Keep the queue alive whatever this request does.
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async execute<T>(path: string, url: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const wait = this.lastStart + this.spacingMs - this.deps.now();
      if (wait > 0) await this.deps.sleep(wait);
      this.lastStart = this.deps.now();

      const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
      const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined;
      let res: Awaited<ReturnType<ClientDeps['fetch']>>;
      try {
        res = await this.deps.fetch(url, {
          headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
          signal: controller?.signal,
        });
      } catch (e) {
        throw new MbError(`Network error: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (timer) clearTimeout(timer);
      }

      if (res.ok) return (await res.json()) as T;
      if (res.status === 404) throw new MbNotFoundError(path);
      if ((res.status === 503 || res.status === 429) && attempt < this.maxRetries) {
        await this.deps.sleep(backoffMs(attempt, this.spacingMs));
        continue;
      }
      throw new MbError(`MusicBrainz responded ${res.status}`, res.status);
    }
  }
}

/** 2.2 s, 4.4 s, 8.8 s, … (on top of the normal spacing). */
export function backoffMs(attempt: number, spacingMs: number): number {
  return spacingMs * 2 ** (attempt + 1);
}

export function buildUrl(path: string, params: Params): string {
  const query = Object.entries({ ...params, fmt: 'json' })
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return `${MB_BASE}${path.replace(/^\//, '')}?${query}`;
}

/** Escape Lucene query syntax in free text typed by the user. */
export function escapeLucene(text: string): string {
  return text.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, '\\$1');
}

/** Shared app-wide client (one queue for the whole app). */
export const mbClient = new MusicBrainzClient();
