import {
  AIErrorKind,
  AnalystAIResponse,
  AuthStatusInfo,
  AuthUserSummary,
  ChatMessage,
  DailyBriefResponse,
  Language,
  PerformanceAIResponse,
} from "../types";
import { getCopy } from "../i18n/translations";
import {
  normalizeAnalystResponse,
  normalizeDailyBriefResponse,
  normalizePerformanceResponse,
  safeParseJson,
} from "../utils/aiNormalizers";
import { ChatIntent } from "./contextRetriever";

export {
  buildAnalystContext,
  buildDailyBriefContext,
  buildPerformanceContext,
  type CompactAnalystContext,
  type CompactDailyBriefContext,
  type CompactPerformanceContext,
} from "../utils/aiContextBuilders";

const IS_DEV = typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV);

export type AuthTokenProvider = (forceRefresh?: boolean) => Promise<string | null>;

// Bearer token held strictly in JS module memory (never written to web storage)
let sessionBearerToken: string | null = null;
let pendingSessionPromise: Promise<{
  token: string;
  expiresAt: number;
  user: AuthUserSummary;
}> | null = null;
let authTokenProvider: AuthTokenProvider | null = null;
const unauthorizedListeners = new Set<() => void>();

export function setAuthToken(token: string | null): void {
  sessionBearerToken = token && token.trim() ? token.trim() : null;
}

export function getAuthToken(): string | null {
  return sessionBearerToken;
}

export function setAuthTokenProvider(provider: AuthTokenProvider | null): void {
  authTokenProvider = provider;
}

export function subscribeUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

export function notifyUnauthorized(): void {
  sessionBearerToken = null;
  for (const listener of unauthorizedListeners) {
    listener();
  }
}

export async function startPublicDemoSession(): Promise<{
  token: string;
  expiresAt: number;
  user: AuthUserSummary;
}> {
  if (pendingSessionPromise) {
    return pendingSessionPromise;
  }

  pendingSessionPromise = (async () => {
    const res = await fetch("/api/demo/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const raw = await res.text();
    const parsed = safeParseJson(raw);
    if (!res.ok || !parsed.ok || typeof parsed.data !== "object" || parsed.data === null) {
      const errMsg =
        parsed.ok && typeof (parsed.data as { error?: unknown })?.error === "string"
          ? (parsed.data as { error: string }).error
          : `Public demo session failed (${res.status})`;
      throw new AIRequestError(res.status === 429 ? "rate_limit" : "server", errMsg, res.status);
    }
    const payload = parsed.data as {
      token?: unknown;
      expiresAt?: unknown;
      user?: AuthUserSummary;
    };
    if (typeof payload.token !== "string" || !payload.token || !payload.user) {
      throw new AIRequestError("invalid_response", "Invalid public demo session response.");
    }
    setAuthToken(payload.token);
    return {
      token: payload.token,
      expiresAt: typeof payload.expiresAt === "number" ? payload.expiresAt : Date.now() + 3_600_000,
      user: payload.user,
    };
  })();

  try {
    return await pendingSessionPromise;
  } finally {
    pendingSessionPromise = null;
  }
}

export async function ensurePublicDemoSession(): Promise<string> {
  if (sessionBearerToken) return sessionBearerToken;
  const session = await startPublicDemoSession();
  return session.token;
}

export async function reissuePublicDemoSession(): Promise<string> {
  sessionBearerToken = null;
  const session = await startPublicDemoSession();
  return session.token;
}

export async function endPublicDemoSession(): Promise<void> {
  const token = sessionBearerToken;
  setAuthToken(null);
  if (!token) return;
  try {
    await fetch("/api/demo/signout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    });
  } catch {
    // Best-effort revocation
  }
}

export async function resolveAuthHeaders(forceRefresh = false): Promise<Record<string, string>> {
  if (authTokenProvider) {
    try {
      const provided = await authTokenProvider(forceRefresh);
      if (provided && provided.trim()) {
        sessionBearerToken = provided.trim();
        return { Authorization: `Bearer ${sessionBearerToken}` };
      }
    } catch {
      // Fall through to in-memory or public demo token
    }
  }

  try {
    const token = forceRefresh
      ? await reissuePublicDemoSession()
      : sessionBearerToken ?? (await ensurePublicDemoSession());
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return sessionBearerToken ? { Authorization: `Bearer ${sessionBearerToken}` } : {};
  }
}

export async function fetchAuthStatus(): Promise<AuthStatusInfo> {
  const headers = await resolveAuthHeaders(false);
  const res = await fetch("/api/auth/status", {
    method: "GET",
    headers,
  });
  if (!res.ok) {
    throw new AIRequestError("server", `Auth status failed (${res.status})`, res.status);
  }
  const data = (await res.json()) as AuthStatusInfo;
  if (!data.authenticated && sessionBearerToken) {
    sessionBearerToken = null;
  }
  return data;
}

export class AIRequestError extends Error {
  readonly kind: AIErrorKind;
  readonly statusCode?: number;

  constructor(kind: AIErrorKind, message: string, statusCode?: number) {
    super(message);
    this.name = "AIRequestError";
    this.kind = kind;
    this.statusCode = statusCode;
  }
}

export function resolveAIError(
  err: unknown,
  language: Language
): { kind: AIErrorKind; message: string } {
  const t = getCopy(language);
  if (err instanceof AIRequestError) {
    if (err.kind === "unauthorized") {
      return { kind: "unauthorized", message: t.aiStates.unauthorizedMessage };
    }
    if (err.kind === "canceled") {
      return { kind: "canceled", message: t.aiStates.canceledMessage };
    }
    if (err.kind === "timeout") {
      return { kind: "timeout", message: t.aiStates.timeoutMessage };
    }
    if (err.kind === "rate_limit") {
      return { kind: "rate_limit", message: t.aiStates.tempUnavailable };
    }
    return { kind: err.kind, message: t.aiStates.errorMessage };
  }

  if (err instanceof Error && err.name === "AbortError") {
    return { kind: "canceled", message: t.aiStates.canceledMessage };
  }

  return { kind: "server", message: t.aiStates.errorMessage };
}

function logClientDevDiagnostic(diag: {
  endpoint: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  payloadBytes: number;
  responseBytes: number;
  status: "success" | "error" | "canceled" | "timeout";
  errorType?: string;
  cancelReason?: string;
}) {
  if (!IS_DEV) return;
  console.debug("[OpsPilot Client Diagnostics]", diag);
}

interface PostJsonOptions<T> {
  timeoutMs?: number;
  signal?: AbortSignal;
  validate?: (raw: unknown) => T | null;
}

async function postJson<T>(
  url: string,
  body: unknown,
  options: PostJsonOptions<T> = {}
): Promise<T> {
  const { timeoutMs = 35_000, signal: externalSignal, validate } = options;

  if (externalSignal?.aborted) {
    throw new AIRequestError("canceled", "Request canceled.");
  }

  const startTime = new Date().toISOString();
  const t0 = performance.now();
  const serializedBody = JSON.stringify(body);
  const payloadBytes = new TextEncoder().encode(serializedBody).length;

  const controller = new AbortController();
  let timedOut = false;
  let externalCanceled = false;

  const onExternalAbort = () => {
    externalCanceled = true;
    controller.abort();
  };
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let responseBytes = 0;

  try {
    let headers = await resolveAuthHeaders(false);
    let res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: serializedBody,
      signal: controller.signal,
    });

    if (res.status === 401) {
      const refreshedHeaders = await resolveAuthHeaders(true);
      if (
        refreshedHeaders.Authorization &&
        refreshedHeaders.Authorization !== headers.Authorization
      ) {
        headers = refreshedHeaders;
        res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
          body: serializedBody,
          signal: controller.signal,
        });
      }
    }

    const rawText = await res.text();
    responseBytes = new TextEncoder().encode(rawText).length;
    const parsed = safeParseJson(rawText);

    if (!res.ok) {
      const serverErr =
        parsed.ok && typeof (parsed.data as { error?: unknown })?.error === "string"
          ? (parsed.data as { error: string }).error
          : `Request failed with status ${res.status}`;
      if (res.status === 401) {
        notifyUnauthorized();
      }
      const kind: AIErrorKind =
        res.status === 401
          ? "unauthorized"
          : res.status === 429
          ? "rate_limit"
          : res.status === 504
          ? "timeout"
          : "server";
      throw new AIRequestError(kind, serverErr, res.status);
    }

    if (!parsed.ok) {
      throw new AIRequestError("invalid_response", "Invalid JSON returned from AI endpoint.");
    }

    const validated = validate ? validate(parsed.data) : (parsed.data as T);
    if (validated === null) {
      throw new AIRequestError("invalid_response", "Incomplete AI response schema.");
    }

    logClientDevDiagnostic({
      endpoint: url,
      startTime,
      endTime: new Date().toISOString(),
      durationMs: Math.round(performance.now() - t0),
      payloadBytes,
      responseBytes,
      status: "success",
    });

    return validated;
  } catch (err) {
    const durationMs = Math.round(performance.now() - t0);
    const endTime = new Date().toISOString();

    if (externalCanceled || externalSignal?.aborted) {
      logClientDevDiagnostic({
        endpoint: url,
        startTime,
        endTime,
        durationMs,
        payloadBytes,
        responseBytes,
        status: "canceled",
        errorType: "AbortError",
        cancelReason: "user_or_unmount",
      });
      throw new AIRequestError("canceled", "Request canceled.");
    }

    if (timedOut || (err instanceof Error && err.name === "AbortError")) {
      logClientDevDiagnostic({
        endpoint: url,
        startTime,
        endTime,
        durationMs,
        payloadBytes,
        responseBytes,
        status: "timeout",
        errorType: "TimeoutError",
        cancelReason: `client_timeout_${timeoutMs}ms`,
      });
      throw new AIRequestError("timeout", "Request timed out.");
    }

    const aiErr =
      err instanceof AIRequestError
        ? err
        : new AIRequestError(
            "network",
            err instanceof Error ? err.message : "Network request failed."
          );

    logClientDevDiagnostic({
      endpoint: url,
      startTime,
      endTime,
      durationMs,
      payloadBytes,
      responseBytes,
      status: aiErr.kind === "timeout" ? "timeout" : "error",
      errorType: aiErr.kind,
    });

    throw aiErr;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

export function fetchDailyBrief(
  language: Language,
  options?: { signal?: AbortSignal }
): Promise<DailyBriefResponse> {
  return postJson<DailyBriefResponse>(
    "/api/ai/daily-brief",
    { language },
    {
      timeoutMs: 35_000,
      signal: options?.signal,
      validate: normalizeDailyBriefResponse,
    }
  );
}

export function fetchAnalystInsights(
  language: Language,
  options?: { signal?: AbortSignal }
): Promise<AnalystAIResponse> {
  return postJson<AnalystAIResponse>(
    "/api/ai/analyst",
    { language },
    {
      timeoutMs: 35_000,
      signal: options?.signal,
      validate: normalizeAnalystResponse,
    }
  );
}

export function fetchPerformanceInsights(
  language: Language,
  options?: { signal?: AbortSignal }
): Promise<PerformanceAIResponse> {
  return postJson<PerformanceAIResponse>(
    "/api/ai/performance-insights",
    { language },
    {
      timeoutMs: 35_000,
      signal: options?.signal,
      validate: normalizePerformanceResponse,
    }
  );
}

export function sendOpsPilotChat(
  language: Language,
  messages: Pick<ChatMessage, "role" | "content">[],
  intent: ChatIntent = "complex_analysis",
  options?: { signal?: AbortSignal; focusNodeId?: string }
): Promise<{ reply: string; intent: ChatIntent; model?: string; totalMs?: number }> {
  return postJson<{ reply: string; intent: ChatIntent; model?: string; totalMs?: number }>(
    "/api/ai/chat",
    {
      language,
      messages,
      intent,
      ...(options?.focusNodeId ? { focusNodeId: options.focusNodeId } : {}),
      stream: false,
    },
    {
      timeoutMs: 30_000,
      signal: options?.signal,
    }
  );
}

export interface StreamChatCallbacks {
  onChunk: (fullText: string, delta: string) => void;
  onMeta?: (meta: { intent: ChatIntent; model?: string; contextBytes?: number }) => void;
  onDone?: (metrics: { ttftMs?: number; totalMs?: number; model?: string }) => void;
  signal?: AbortSignal;
  focusNodeId?: string;
}

export async function streamOpsPilotChat(
  language: Language,
  messages: Pick<ChatMessage, "role" | "content">[],
  intent: ChatIntent,
  callbacks: StreamChatCallbacks
): Promise<{ reply: string; ttftMs?: number; totalMs?: number; model?: string }> {
  if (callbacks.signal?.aborted) {
    throw new AIRequestError("canceled", "Request canceled.");
  }

  const startTime = new Date().toISOString();
  const t0 = performance.now();
  const controller = new AbortController();
  const timeoutMs = intent === "greeting" ? 15_000 : 35_000;
  let timedOut = false;
  let externalCanceled = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onExternalAbort = () => {
    externalCanceled = true;
    controller.abort();
  };
  callbacks.signal?.addEventListener("abort", onExternalAbort, { once: true });

  const serializedBody = JSON.stringify({
    language,
    messages,
    intent,
    ...(callbacks.focusNodeId ? { focusNodeId: callbacks.focusNodeId } : {}),
    stream: true,
  });
  const payloadBytes = new TextEncoder().encode(serializedBody).length;
  let responseBytes = 0;

  try {
    let headers = await resolveAuthHeaders(false);
    let res = await fetch("/api/ai/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...headers,
      },
      body: serializedBody,
      signal: controller.signal,
    });

    if (res.status === 401) {
      const refreshedHeaders = await resolveAuthHeaders(true);
      if (
        refreshedHeaders.Authorization &&
        refreshedHeaders.Authorization !== headers.Authorization
      ) {
        headers = refreshedHeaders;
        res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            ...headers,
          },
          body: serializedBody,
          signal: controller.signal,
        });
      }
    }

    if (!res.ok) {
      let errMsg = `Request failed with status ${res.status}`;
      try {
        const rawErr = await res.text();
        responseBytes = new TextEncoder().encode(rawErr).length;
        const parsed = safeParseJson(rawErr);
        if (parsed.ok && typeof (parsed.data as { error?: unknown })?.error === "string") {
          errMsg = (parsed.data as { error: string }).error;
        }
      } catch {
        // ignore parse errors
      }
      if (res.status === 401) {
        notifyUnauthorized();
      }
      const kind: AIErrorKind =
        res.status === 401
          ? "unauthorized"
          : res.status === 429
          ? "rate_limit"
          : res.status === 504
          ? "timeout"
          : "server";
      throw new AIRequestError(kind, errMsg, res.status);
    }

    if (!res.body) {
      throw new AIRequestError("invalid_response", "Streaming response body is unavailable.");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";
    const MAX_STREAM_CHARS = 40_000;
    let finalMeta: { ttftMs?: number; totalMs?: number; model?: string } = {};

    const processSseBlock = (block: string) => {
      const lines = block.split(/\r?\n/);
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const rawJson = line.slice(5).trim();
        if (!rawJson) continue;
        const parsedEvt = safeParseJson(rawJson);
        if (!parsedEvt.ok || typeof parsedEvt.data !== "object" || parsedEvt.data === null) {
          continue;
        }
        const evt = parsedEvt.data as {
          type?: string;
          text?: string;
          intent?: ChatIntent;
          model?: string;
          contextBytes?: number;
          ttftMs?: number;
          totalMs?: number;
          message?: string;
          code?: string;
        };

        if (evt.type === "meta") {
          callbacks.onMeta?.({
            intent: evt.intent ?? intent,
            model: evt.model,
            contextBytes: evt.contextBytes,
          });
        } else if (evt.type === "chunk" && typeof evt.text === "string") {
          if (fullText.length < MAX_STREAM_CHARS) {
            const remaining = MAX_STREAM_CHARS - fullText.length;
            const safeDelta = evt.text.slice(0, remaining);
            fullText += safeDelta;
            callbacks.onChunk(fullText, safeDelta);
          }
        } else if (evt.type === "done") {
          finalMeta = {
            ttftMs: evt.ttftMs,
            totalMs: evt.totalMs,
            model: evt.model,
          };
          callbacks.onDone?.(finalMeta);
        } else if (evt.type === "error") {
          const kind: AIErrorKind =
            evt.code === "RATE_LIMIT"
              ? "rate_limit"
              : evt.code === "TIMEOUT"
              ? "timeout"
              : "server";
          throw new AIRequestError(
            kind,
            evt.message || "Unable to complete AI request right now."
          );
        }
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) responseBytes += value.byteLength;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? "";

      for (const block of parts) {
        processSseBlock(block);
      }
    }

    if (buffer.trim()) {
      processSseBlock(buffer);
    }

    logClientDevDiagnostic({
      endpoint: "/api/ai/chat",
      startTime,
      endTime: new Date().toISOString(),
      durationMs: Math.round(performance.now() - t0),
      payloadBytes,
      responseBytes,
      status: "success",
    });

    return { reply: fullText, ...finalMeta };
  } catch (err) {
    const durationMs = Math.round(performance.now() - t0);
    const endTime = new Date().toISOString();

    if (externalCanceled || callbacks.signal?.aborted) {
      logClientDevDiagnostic({
        endpoint: "/api/ai/chat",
        startTime,
        endTime,
        durationMs,
        payloadBytes,
        responseBytes,
        status: "canceled",
        errorType: "AbortError",
        cancelReason: "user_or_unmount",
      });
      throw new AIRequestError("canceled", "Request canceled.");
    }

    if (timedOut || (err instanceof Error && err.name === "AbortError")) {
      logClientDevDiagnostic({
        endpoint: "/api/ai/chat",
        startTime,
        endTime,
        durationMs,
        payloadBytes,
        responseBytes,
        status: "timeout",
        errorType: "TimeoutError",
        cancelReason: `client_timeout_${timeoutMs}ms`,
      });
      throw new AIRequestError("timeout", "Request timed out.");
    }

    const aiErr =
      err instanceof AIRequestError
        ? err
        : new AIRequestError(
            "network",
            err instanceof Error ? err.message : "Network request failed."
          );

    logClientDevDiagnostic({
      endpoint: "/api/ai/chat",
      startTime,
      endTime,
      durationMs,
      payloadBytes,
      responseBytes,
      status: aiErr.kind === "timeout" ? "timeout" : "error",
      errorType: aiErr.kind,
    });

    throw aiErr;
  } finally {
    clearTimeout(timer);
    callbacks.signal?.removeEventListener("abort", onExternalAbort);
  }
}
