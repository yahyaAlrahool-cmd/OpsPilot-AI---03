import crypto from "crypto";
import type express from "express";
import {
  getFirebaseConfig,
  type VerifiedFirebaseUser,
  verifyFirebaseIdToken,
} from "./firebaseAuth.js";
import type { AuthMode, AuthStatusInfo } from "../src/types.js";

const IS_DEV = process.env.NODE_ENV !== "production";

export interface PublicDemoUser {
  uid: string;
  email: string | null;
  name: string | null;
  emailVerified: true;
  expMs: number;
  isPublicDemo: true;
}

export type AuthCaller =
  | (VerifiedFirebaseUser & { isPublicDemo?: false })
  | PublicDemoUser;

export interface AuthenticatedRequest extends express.Request {
  authCaller?: AuthCaller;
}

const PUBLIC_DEMO_NAME = "Portfolio Visitor";
const PUBLIC_DEMO_TTL_MS = 4 * 60 * 60 * 1000;
const MAX_PUBLIC_DEMO_SESSIONS = 250;

interface PublicDemoSessionRecord {
  uid: string;
  expiresAt: number;
  lastSeenAt: number;
}

// Ephemeral SHA-256 hashes of per-visitor public demo tokens -> isolated demo_<hex> workspace UID
const publicDemoSessions = new Map<string, PublicDemoSessionRecord>();

export function isPublicDemoEnabled(): boolean {
  return process.env.OPSPILOT_PUBLIC_DEMO !== "false";
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function pruneExpiredPublicDemoSessions(now = Date.now()): void {
  for (const [hash, rec] of publicDemoSessions) {
    if (rec.expiresAt <= now) {
      publicDemoSessions.delete(hash);
    }
  }
  while (publicDemoSessions.size >= MAX_PUBLIC_DEMO_SESSIONS) {
    const oldest = publicDemoSessions.keys().next().value;
    if (!oldest) break;
    publicDemoSessions.delete(oldest);
  }
}

export function issuePublicDemoSession(): {
  token: string;
  expiresAt: number;
  user: {
    uid: string;
    email: null;
    name: string;
    emailVerified: true;
  };
} | null {
  if (!isPublicDemoEnabled()) return null;

  const now = Date.now();
  pruneExpiredPublicDemoSessions(now);

  const uid = `demo_${crypto.randomBytes(12).toString("hex")}`;
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = now + PUBLIC_DEMO_TTL_MS;
  publicDemoSessions.set(hashToken(token), {
    uid,
    expiresAt,
    lastSeenAt: now,
  });

  return {
    token,
    expiresAt,
    user: {
      uid,
      email: null,
      name: PUBLIC_DEMO_NAME,
      emailVerified: true,
    },
  };
}

function verifyPublicDemoToken(token: string): PublicDemoUser | null {
  if (!isPublicDemoEnabled()) return null;
  if (!/^[a-f0-9]{64}$/i.test(token)) return null;

  const hashed = hashToken(token);
  const rec = publicDemoSessions.get(hashed);
  if (!rec) return null;

  const now = Date.now();
  if (rec.expiresAt <= now) {
    publicDemoSessions.delete(hashed);
    return null;
  }

  // Touch LRU insertion order
  publicDemoSessions.delete(hashed);
  rec.lastSeenAt = now;
  publicDemoSessions.set(hashed, rec);

  return {
    uid: rec.uid,
    email: null,
    name: PUBLIC_DEMO_NAME,
    emailVerified: true,
    expMs: rec.expiresAt,
    isPublicDemo: true,
  };
}

export function revokePublicDemoTokenFromRequest(req: express.Request): void {
  if (!isPublicDemoEnabled()) return;
  const bearer = extractBearerToken(req);
  if (!bearer) return;
  publicDemoSessions.delete(hashToken(bearer));
}

function extractBearerToken(req: express.Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== "string") return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  return token.length >= 20 && token.length <= 8_192 ? token : null;
}

export function getAuthMode(): AuthMode {
  if (isPublicDemoEnabled()) return "public_demo";
  return getFirebaseConfig() ? "firebase_google" : "unconfigured";
}

export async function verifyRequestAuth(
  req: express.Request
): Promise<AuthCaller | null> {
  const bearer = extractBearerToken(req);
  if (!bearer) return null;

  if (isPublicDemoEnabled()) {
    const demoCaller = verifyPublicDemoToken(bearer);
    if (demoCaller) return demoCaller;
  }

  if (getFirebaseConfig()) {
    return verifyFirebaseIdToken(bearer);
  }
  return null;
}

export async function getAuthStatus(req: express.Request): Promise<AuthStatusInfo> {
  const authMode = getAuthMode();
  const verified = await verifyRequestAuth(req);
  const publicDemoEnabled = isPublicDemoEnabled();
  const isPublicDemo = Boolean(verified && "isPublicDemo" in verified && verified.isPublicDemo);

  return {
    authenticated: Boolean(verified),
    authMode,
    setupAllowed: false,
    publicDemoEnabled,
    isPublicDemo,
    expiresAt: verified?.expMs ?? null,
    user: verified
      ? {
          uid: verified.uid,
          email: verified.email,
          name: verified.name,
          emailVerified: verified.emailVerified,
        }
      : null,
  };
}

export async function requireAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): Promise<void> {
  const authMode = getAuthMode();
  const publicDemoEnabled = isPublicDemoEnabled();

  if (authMode === "unconfigured" && !publicDemoEnabled) {
    res.status(503).json({
      error: "Authentication is not configured for this server.",
      code: "AUTH_NOT_CONFIGURED",
    });
    return;
  }

  try {
    const verified = await verifyRequestAuth(req);
    if (!verified) {
      res.status(401).json({
        error: "Valid session authentication is required to access workspace and AI endpoints.",
        code: "AUTH_REQUIRED",
      });
      return;
    }

    if ("isPublicDemo" in verified && verified.isPublicDemo && !publicDemoEnabled) {
      res.status(401).json({
        error: "Public demo mode is disabled.",
        code: "AUTH_REQUIRED",
      });
      return;
    }

    (req as AuthenticatedRequest).authCaller = verified;
    next();
  } catch {
    res.status(401).json({
      error: "Unable to verify session credentials.",
      code: "AUTH_REQUIRED",
    });
  }
}

// Configurable bounded in-memory rate limiter
interface RateBucket {
  count: number;
  resetAt: number;
}

const MAX_RATE_BUCKETS = 10_000;

export function getClientIp(req: express.Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function readEnvPositiveInt(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name]);
  if (Number.isFinite(raw) && raw >= min && raw <= max) {
    return Math.floor(raw);
  }
  return fallback;
}

export function createRateLimiter(options: {
  windowEnvVar: string;
  maxEnvVar: string;
  defaultWindowMs: number;
  defaultMaxRequests: number;
  keyBuilder: (req: express.Request) => string;
  errorMessage: string;
}): express.RequestHandler {
  const buckets = new Map<string, RateBucket>();

  return (req, res, next) => {
    const windowMs = readEnvPositiveInt(
      options.windowEnvVar,
      options.defaultWindowMs,
      1_000,
      86_400_000
    );
    const maxRequests = readEnvPositiveInt(
      options.maxEnvVar,
      options.defaultMaxRequests,
      1,
      10_000
    );

    const now = Date.now();
    if (buckets.size >= MAX_RATE_BUCKETS) {
      for (const [k, b] of buckets) {
        if (b.resetAt <= now) buckets.delete(k);
      }
      while (buckets.size >= MAX_RATE_BUCKETS) {
        const oldest = buckets.keys().next().value;
        if (!oldest) break;
        buckets.delete(oldest);
      }
    }

    const key = options.keyBuilder(req);
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, maxRequests - bucket.count);
    const resetSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

    res.setHeader("RateLimit-Limit", String(maxRequests));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(resetSeconds));

    if (bucket.count > maxRequests) {
      res.setHeader("Retry-After", String(resetSeconds));
      res.status(429).json({
        error: options.errorMessage,
        code: "RATE_LIMIT_EXCEEDED",
        retryAfterSeconds: resetSeconds,
      });
      return;
    }

    next();
  };
}

export function createAiRateLimiter(): express.RequestHandler {
  return createRateLimiter({
    windowEnvVar: "AI_RATE_LIMIT_WINDOW_MS",
    maxEnvVar: "AI_RATE_LIMIT_MAX_REQUESTS",
    defaultWindowMs: 60_000,
    defaultMaxRequests: 15,
    keyBuilder: (req) => {
      const caller = (req as AuthenticatedRequest).authCaller;
      return `ai::${getClientIp(req)}::${caller?.uid ?? "anon"}`;
    },
    errorMessage: "Too many AI requests. Please wait before trying again.",
  });
}

export function createWorkspaceRateLimiter(): express.RequestHandler {
  return createRateLimiter({
    windowEnvVar: "WORKSPACE_RATE_LIMIT_WINDOW_MS",
    maxEnvVar: "WORKSPACE_RATE_LIMIT_MAX_REQUESTS",
    defaultWindowMs: 60_000,
    defaultMaxRequests: 60,
    keyBuilder: (req) => {
      const caller = (req as AuthenticatedRequest).authCaller;
      return `ws::${getClientIp(req)}::${caller?.uid ?? "anon"}`;
    },
    errorMessage: "Too many workspace requests. Please wait before trying again.",
  });
}

export function createAuthRateLimiter(): express.RequestHandler {
  return createRateLimiter({
    windowEnvVar: "AUTH_RATE_LIMIT_WINDOW_MS",
    maxEnvVar: "AUTH_RATE_LIMIT_MAX_REQUESTS",
    defaultWindowMs: 900_000,
    defaultMaxRequests: 30,
    keyBuilder: (req) => `auth::${getClientIp(req)}`,
    errorMessage: "Too many authentication status requests. Please wait before retrying.",
  });
}

export function createDemoSessionRateLimiter(): express.RequestHandler {
  return createRateLimiter({
    windowEnvVar: "DEMO_SESSION_RATE_LIMIT_WINDOW_MS",
    maxEnvVar: "DEMO_SESSION_RATE_LIMIT_MAX_REQUESTS",
    defaultWindowMs: 900_000,
    defaultMaxRequests: 20,
    keyBuilder: (req) => `demo-sess::${getClientIp(req)}`,
    errorMessage: "Too many demo session requests. Please wait before retrying.",
  });
}

// Security headers compatible with AI Studio iFrame hosting
export function securityHeadersMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  const proto =
    typeof req.headers["x-forwarded-proto"] === "string"
      ? req.headers["x-forwarded-proto"].split(",")[0].trim()
      : req.protocol;
  if (!IS_DEV && (req.secure || proto === "https")) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  next();
}

function getConfiguredAllowedOrigins(): Set<string> {
  const raw = process.env.OPSPILOT_ALLOWED_ORIGINS ?? "";
  const allowed = new Set<string>();
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed || trimmed === "*") continue;
    try {
      const url = new URL(trimmed);
      if (url.protocol === "http:" || url.protocol === "https:") {
        allowed.add(url.origin);
      }
    } catch {
      // Ignore invalid origin entries
    }
  }
  return allowed;
}

function isSameOrigin(originHeader: string, req: express.Request): boolean {
  const rawHost =
    (typeof req.headers["x-forwarded-host"] === "string"
      ? req.headers["x-forwarded-host"].split(",")[0].trim()
      : req.headers.host) ?? "";
  if (!rawHost) return false;

  const proto =
    typeof req.headers["x-forwarded-proto"] === "string"
      ? req.headers["x-forwarded-proto"].split(",")[0].trim()
      : req.protocol || "http";

  if (originHeader === `${proto}://${rawHost}`) {
    return true;
  }

  try {
    const parsedOrigin = new URL(originHeader);
    return (
      parsedOrigin.host === rawHost &&
      (parsedOrigin.protocol === "http:" || parsedOrigin.protocol === "https:")
    );
  } catch {
    return false;
  }
}

export function apiCorsMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const origin = req.headers.origin;
  if (!origin) {
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
    return;
  }

  const configuredOrigins = getConfiguredAllowedOrigins();
  const allowed = isSameOrigin(origin, req) || configuredOrigins.has(origin);

  res.setHeader("Vary", "Origin");

  if (!allowed) {
    res.status(403).json({
      error: "Origin not allowed by CORS policy.",
      code: "CORS_FORBIDDEN",
    });
    return;
  }

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "600");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
}
