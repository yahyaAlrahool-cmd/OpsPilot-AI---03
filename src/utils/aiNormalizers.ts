import type {
  AnalystAIResponse,
  DailyBriefResponse,
  PerformanceAIResponse,
} from "../types.js";

function asCleanString(val: unknown, fallback = ""): string {
  if (typeof val === "string") return val.trim();
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  return fallback;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

export function safeParseJson(
  rawText: string
): { ok: true; data: unknown } | { ok: false; error: string } {
  const trimmed = (rawText ?? "").trim();
  if (!trimmed) {
    return { ok: false, error: "Empty response body" };
  }

  // Strip optional markdown code fences if a model wraps JSON in ```json ... ```
  let cleaned = trimmed;
  if (cleaned.startsWith("```")) {
    cleaned = cleaned
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
  }

  try {
    return { ok: true, data: JSON.parse(cleaned) };
  } catch (err) {
    // Attempt extracting outermost JSON object if surrounded by unexpected prose
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return { ok: true, data: JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) };
      } catch {
        // fall through
      }
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Invalid JSON response",
    };
  }
}

export function normalizeDailyBriefResponse(raw: unknown): DailyBriefResponse | null {
  if (!isPlainObject(raw)) return null;

  const overallStatus = asCleanString(raw.overallStatus);
  const mostUrgentIssue = asCleanString(raw.mostUrgentIssue);
  const workloadConcerns = asCleanString(raw.workloadConcerns);

  const attentionToday = Array.isArray(raw.attentionToday)
    ? raw.attentionToday
        .filter(isPlainObject)
        .map((item) => ({
          projectId: asCleanString(item.projectId, "-"),
          projectTitle: asCleanString(item.projectTitle, "-"),
          reason: asCleanString(item.reason),
          deadline: asCleanString(item.deadline, "-"),
        }))
        .filter((item) => item.projectId !== "-" || item.projectTitle !== "-" || item.reason !== "")
    : [];

  const recommendedPriorities = Array.isArray(raw.recommendedPriorities)
    ? raw.recommendedPriorities
        .filter(isPlainObject)
        .map((item) => ({
          observation: asCleanString(item.observation),
          evidence: asCleanString(item.evidence),
          impact: asCleanString(item.impact),
          action: asCleanString(item.action),
        }))
        .filter((item) => item.action !== "" || item.observation !== "")
    : [];

  if (
    !overallStatus &&
    !mostUrgentIssue &&
    !workloadConcerns &&
    attentionToday.length === 0 &&
    recommendedPriorities.length === 0
  ) {
    return null;
  }

  return {
    overallStatus: overallStatus || "-",
    mostUrgentIssue: mostUrgentIssue || "-",
    attentionToday,
    workloadConcerns: workloadConcerns || "-",
    recommendedPriorities,
  };
}

export function normalizeAnalystResponse(raw: unknown): AnalystAIResponse | null {
  if (!isPlainObject(raw)) return null;

  const executiveSummary = asCleanString(raw.executiveSummary);

  const bottlenecksDetected = Array.isArray(raw.bottlenecksDetected)
    ? raw.bottlenecksDetected
        .filter(isPlainObject)
        .map((b) => ({
          title: asCleanString(b.title, "-"),
          observation: asCleanString(b.observation),
          evidence: asCleanString(b.evidence),
          impact: asCleanString(b.impact),
          action: asCleanString(b.action),
        }))
        .filter((b) => b.title !== "-" || b.observation !== "" || b.action !== "")
    : [];

  const rankedActions = Array.isArray(raw.rankedActions)
    ? raw.rankedActions
        .filter(isPlainObject)
        .map((a) => ({
          priority: asCleanString(a.priority, "P1"),
          relatedProjectId: asCleanString(a.relatedProjectId, "-"),
          action: asCleanString(a.action),
          reason: asCleanString(a.reason),
          expectedImpact: asCleanString(a.expectedImpact),
        }))
        .filter((a) => a.action !== "" || a.reason !== "")
    : [];

  if (!executiveSummary && bottlenecksDetected.length === 0 && rankedActions.length === 0) {
    return null;
  }

  return {
    executiveSummary: executiveSummary || "-",
    bottlenecksDetected,
    rankedActions,
  };
}

export function normalizePerformanceResponse(raw: unknown): PerformanceAIResponse | null {
  if (!isPlainObject(raw)) return null;

  const whatsImproving = Array.isArray(raw.whatsImproving)
    ? raw.whatsImproving
        .filter(isPlainObject)
        .map((item) => ({
          observation: asCleanString(item.observation),
          evidence: asCleanString(item.evidence),
        }))
        .filter((item) => item.observation !== "" || item.evidence !== "")
    : [];

  const whatsGettingWorse = Array.isArray(raw.whatsGettingWorse)
    ? raw.whatsGettingWorse
        .filter(isPlainObject)
        .map((item) => ({
          observation: asCleanString(item.observation),
          evidence: asCleanString(item.evidence),
        }))
        .filter((item) => item.observation !== "" || item.evidence !== "")
    : [];

  const delayPatterns = Array.isArray(raw.delayPatterns)
    ? raw.delayPatterns
        .filter(isPlainObject)
        .map((item) => ({
          pattern: asCleanString(item.pattern),
          evidence: asCleanString(item.evidence),
          impact: asCleanString(item.impact),
        }))
        .filter((item) => item.pattern !== "" || item.evidence !== "")
    : [];

  const improvementActions = Array.isArray(raw.improvementActions)
    ? raw.improvementActions
        .filter(isPlainObject)
        .map((item) => ({
          action: asCleanString(item.action),
          evidence: asCleanString(item.evidence),
          expectedImpact: asCleanString(item.expectedImpact),
        }))
        .filter((item) => item.action !== "" || item.evidence !== "")
    : [];

  if (
    whatsImproving.length === 0 &&
    whatsGettingWorse.length === 0 &&
    delayPatterns.length === 0 &&
    improvementActions.length === 0
  ) {
    return null;
  }

  return {
    whatsImproving,
    whatsGettingWorse,
    delayPatterns,
    improvementActions,
  };
}
