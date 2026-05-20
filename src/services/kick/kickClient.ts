import { ipc } from "@/lib/ipc";

import type { KickFetchInit, KickServiceOptions } from "./kickTypes";

const DEFAULT_RETRIES = 3;
const DEFAULT_MIN_DELAY_MS = 350;
const DEFAULT_TIMEOUT_MS = 15_000;

export class KickClient {
  private readonly retries: number;
  private readonly minDelayMs: number;
  private readonly requestTimeoutMs: number;
  private readonly accessToken: string | null;
  private readonly signal: AbortSignal | null;
  private readonly customFetchText?: (url: string, init?: KickFetchInit) => Promise<string>;
  private readonly customFetchJson?: <T = unknown>(url: string, init?: KickFetchInit) => Promise<T>;
  private nextRequestAt = 0;

  constructor(options: KickServiceOptions = {}) {
    this.retries = options.retries ?? DEFAULT_RETRIES;
    this.minDelayMs = options.minDelayMs ?? DEFAULT_MIN_DELAY_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.accessToken = options.accessToken?.trim() || null;
    this.signal = options.signal ?? null;
    this.customFetchText = options.fetchText;
    this.customFetchJson = options.fetchJson;
  }

  hasAccessToken(): boolean {
    return Boolean(this.accessToken);
  }

  async getJson<T = unknown>(url: string, init: KickFetchInit = {}): Promise<T> {
    if (this.customFetchJson) {
      return this.withRetry(() => this.customFetchJson!(url, this.withSignal(init)));
    }
    const text = await this.getText(url, init);
    return JSON.parse(text) as T;
  }

  async getText(url: string, init: KickFetchInit = {}): Promise<string> {
    if (this.customFetchText) {
      return this.withRetry(() => this.customFetchText!(url, this.withSignal(init)));
    }

    const request = this.withSignal(init);
    const headers = request.headers ?? {};
    const hasAuth = Boolean(headers.Authorization);
    if (!hasAuth && request.method !== "GET") {
      throw new Error("KickClient only supports GET requests.");
    }

    if (!hasAuth && Object.keys(headers).length === 0) {
      return this.withRetry(() => ipc.fetchText(url, request.referer ?? null));
    }

    return this.withRetry(async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), this.requestTimeoutMs);
      const abortListener = () => controller.abort();
      request.signal?.addEventListener("abort", abortListener, { once: true });
      try {
        const response = await fetch(url, {
          method: request.method ?? "GET",
          headers,
          signal: controller.signal,
        });
        if (!response.ok) {
          throw createHttpError(response.status, response.statusText, response.headers.get("retry-after"));
        }
        return await response.text();
      } finally {
        window.clearTimeout(timeout);
        request.signal?.removeEventListener("abort", abortListener);
      }
    });
  }

  officialHeaders(): Record<string, string> {
    if (!this.accessToken) return {};
    return {
      Accept: "application/json",
      Authorization: `Bearer ${this.accessToken}`,
    };
  }

  private withSignal(init: KickFetchInit): KickFetchInit {
    return {
      ...init,
      signal: init.signal ?? this.signal,
    };
  }

  private async withRetry<T>(request: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      await this.waitForRateLimit();
      try {
        return await request();
      } catch (error) {
        lastError = error;
        if (this.isAbortError(error) || attempt >= this.retries) break;
        await delay(getRetryDelayMs(error, attempt));
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const waitMs = Math.max(0, this.nextRequestAt - now);
    this.nextRequestAt = Math.max(now, this.nextRequestAt) + this.minDelayMs;
    if (waitMs > 0) await delay(waitMs);
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === "AbortError";
  }
}

export function createKickClient(options?: KickServiceOptions): KickClient {
  return new KickClient(options);
}

function createHttpError(status: number, statusText: string, retryAfter: string | null): Error {
  const error = new Error(`Kick HTTP ${status}: ${statusText}`) as Error & {
    status?: number;
    retryAfterMs?: number;
  };
  error.status = status;
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) error.retryAfterMs = Math.max(0, seconds * 1000);
  }
  return error;
}

function getRetryDelayMs(error: unknown, attempt: number): number {
  const retryAfterMs = typeof error === "object" && error && "retryAfterMs" in error
    ? Number((error as { retryAfterMs?: number }).retryAfterMs)
    : NaN;
  if (Number.isFinite(retryAfterMs)) return retryAfterMs;
  return Math.min(5000, 650 * 2 ** attempt);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
