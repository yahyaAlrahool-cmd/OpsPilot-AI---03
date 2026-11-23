import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface FirebaseAppletConfig {
  projectId: string;
  firestoreDatabaseId: string;
  apiKey?: string;
  authDomain?: string;
}

export interface VerifiedFirebaseUser {
  uid: string;
  email: string | null;
  name: string | null;
  emailVerified: boolean;
  expMs: number;
  idToken: string;
}

const GOOGLE_CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const VALID_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

let cachedConfig: FirebaseAppletConfig | null = null;
let cachedCerts: { certs: Record<string, string>; expiresAtMs: number } | null = null;
let certsFetchInFlight: Promise<Record<string, string>> | null = null;

export function getFirebaseConfig(): FirebaseAppletConfig | null {
  if (cachedConfig) return cachedConfig;

  const candidates = [
    path.resolve(process.cwd(), "firebase-applet-config.json"),
    path.resolve(__dirname, "..", "firebase-applet-config.json"),
    path.resolve(__dirname, "..", "..", "firebase-applet-config.json"),
  ];

  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<FirebaseAppletConfig>;
      if (
        typeof raw.projectId === "string" &&
        raw.projectId.trim().length > 0 &&
        typeof raw.firestoreDatabaseId === "string" &&
        raw.firestoreDatabaseId.trim().length > 0 &&
        raw.projectId !== "remixed-project-id"
      ) {
        cachedConfig = {
          projectId: raw.projectId.trim(),
          firestoreDatabaseId: raw.firestoreDatabaseId.trim(),
          apiKey: raw.apiKey,
          authDomain: raw.authDomain,
        };
        return cachedConfig;
      }
    } catch {
      // Try next candidate path
    }
  }
  return null;
}

function parseMaxAgeSeconds(cacheControl: string | null): number {
  if (!cacheControl) return 3600;
  const match = cacheControl.match(/max-age=(\d+)/i);
  if (!match) return 3600;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 60 ? Math.min(parsed, 86_400) : 3600;
}

async function fetchGoogleCerts(forceRefresh = false): Promise<Record<string, string>> {
  const now = Date.now();
  if (!forceRefresh && cachedCerts && now < cachedCerts.expiresAtMs) {
    return cachedCerts.certs;
  }

  if (certsFetchInFlight && !forceRefresh) {
    return certsFetchInFlight;
  }

  const promise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const res = await fetch(GOOGLE_CERTS_URL, {
        method: "GET",
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Failed to fetch Firebase signing certs (${res.status})`);
      }
      const certs = (await res.json()) as Record<string, string>;
      const maxAgeSec = parseMaxAgeSeconds(res.headers.get("cache-control"));
      cachedCerts = {
        certs,
        expiresAtMs: Date.now() + maxAgeSec * 1000,
      };
      return certs;
    } finally {
      clearTimeout(timer);
      certsFetchInFlight = null;
    }
  })();

  certsFetchInFlight = promise;
  return promise;
}

function decodeBase64UrlJson(segment: string): Record<string, unknown> | null {
  try {
    const raw = Buffer.from(segment, "base64url").toString("utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function verifyFirebaseIdToken(
  token: string
): Promise<VerifiedFirebaseUser | null> {
  const config = getFirebaseConfig();
  if (!config) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerSeg, payloadSeg, sigSeg] = parts;
  if (!headerSeg || !payloadSeg || !sigSeg) return null;

  const header = decodeBase64UrlJson(headerSeg);
  const payload = decodeBase64UrlJson(payloadSeg);
  if (!header || !payload) return null;

  if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) {
    return null;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const expectedIssuer = `https://securetoken.google.com/${config.projectId}`;

  if (payload.aud !== config.projectId) return null;
  if (payload.iss !== expectedIssuer) return null;
  if (typeof payload.sub !== "string" || !VALID_ID_RE.test(payload.sub)) return null;
  if (typeof payload.exp !== "number" || payload.exp <= nowSec) return null;
  if (typeof payload.iat !== "number" || payload.iat > nowSec + 300) return null;
  if (typeof payload.auth_time === "number" && payload.auth_time > nowSec + 300) return null;
  if (payload.email_verified !== true) return null;

  let certs = await fetchGoogleCerts(false);
  let pem = certs[header.kid];
  if (!pem) {
    certs = await fetchGoogleCerts(true);
    pem = certs[header.kid];
  }
  if (!pem) return null;

  try {
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(`${headerSeg}.${payloadSeg}`);
    verifier.end();
    const sigBuf = Buffer.from(sigSeg, "base64url");
    const validSig = verifier.verify(pem, sigBuf);
    if (!validSig) return null;
  } catch {
    return null;
  }

  return {
    uid: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
    name: typeof payload.name === "string" ? payload.name : null,
    emailVerified: true,
    expMs: payload.exp * 1000,
    idToken: token,
  };
}
