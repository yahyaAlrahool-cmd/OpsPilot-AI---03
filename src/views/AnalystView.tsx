import React from "react";
import { AlertCircle, RefreshCw, ShieldAlert, Sparkles, XCircle } from "lucide-react";
import {
  AIErrorKind,
  AIRequestStatus,
  AnalystAIResponse,
  Language,
  Project,
  ProjectRiskAssessment,
  RiskLevel,
} from "../types";
import { getCopy } from "../i18n/translations";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { EpistemicTag, RiskLevelLabel } from "../components/StatusIndicator";

interface AnalystViewProps {
  language: Language;
  risks: ProjectRiskAssessment[];
  aiAnalysis: AnalystAIResponse | null;
  aiStatus: AIRequestStatus;
  aiErrorKind: AIErrorKind | null;
  aiError: string | null;
  onRunAnalysis: () => void;
  onCancelAnalysis: () => void;
  onInspectProject: (project: Project) => void;
}

export const AnalystView = React.memo(function AnalystView({
  language,
  risks,
  aiAnalysis,
  aiStatus,
  aiErrorKind,
  aiError,
  onRunAnalysis,
  onCancelAnalysis,
  onInspectProject,
}: AnalystViewProps) {
  const t = getCopy(language);
  const isAnalyzing = aiStatus === "analyzing";

  const counts: Record<RiskLevel, number> = {
    critical: risks.filter((r) => r.riskLevel === "critical").length,
    high: risks.filter((r) => r.riskLevel === "high").length,
    medium: risks.filter((r) => r.riskLevel === "medium").length,
    low: risks.filter((r) => r.riskLevel === "low").length,
  };

  const bottlenecksList = Array.isArray(aiAnalysis?.bottlenecksDetected)
    ? aiAnalysis.bottlenecksDetected
    : [];
  const rankedActionsList = Array.isArray(aiAnalysis?.rankedActions)
    ? aiAnalysis.rankedActions
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0F294A] dark:text-slate-100">
            {t.analyst.title}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t.analyst.subtitle}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isAnalyzing && (
            <button
              type="button"
              onClick={onCancelAnalysis}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <XCircle className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
              <span>{t.aiStates.cancel}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onRunAnalysis}
            disabled={isAnalyzing}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
              {isAnalyzing ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>{t.analyst.runDeepAnalysis}</span>
            </button>
        </div>
      </div>

      {/* Risk Count Summary */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {(
          [
            {
              key: "critical",
              label: t.analyst.summaryCards.critical,
              cls: "text-red-700 dark:text-red-400",
            },
            {
              key: "high",
              label: t.analyst.summaryCards.high,
              cls: "text-amber-700 dark:text-amber-400",
            },
            {
              key: "medium",
              label: t.analyst.summaryCards.medium,
              cls: "text-blue-800 dark:text-blue-400",
            },
            {
              key: "low",
              label: t.analyst.summaryCards.low,
              cls: "text-emerald-700 dark:text-emerald-400",
            },
          ] as const
        ).map((item) => (
          <div
            key={item.key}
            className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4"
          >
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {item.label}
            </div>
            <div className={`text-2xl font-bold font-mono-num mt-2 ${item.cls}`}>
              {counts[item.key]}
            </div>
          </div>
        ))}
      </section>

      {/* AI Deep Analysis Panel */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-50/70 dark:bg-[#162033]">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-700 dark:text-blue-400" />
            <h2 className="text-sm font-semibold text-[#0F294A] dark:text-slate-100">
              {t.analyst.aiBottlenecks}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {t.aiStates.statusLabels[aiStatus]}
            </span>
            <EpistemicTag kind="recommendation" label={t.epistemic.aiRecommendation} />
          </div>
        </div>

        <div className="p-6">
          <ErrorBoundary variant="panel" language={language} onRetry={onRunAnalysis}>
            {aiStatus === "analyzing" ? (
              <div className="space-y-3 animate-pulse">
                <div className="h-4 bg-slate-100 dark:bg-slate-800 rounded w-2/3" />
                <div className="h-20 bg-slate-100 dark:bg-slate-800 rounded" />
                <div className="flex items-center justify-between gap-3 pt-1">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t.analyst.analyzing}
                  </p>
                  <button
                    type="button"
                    onClick={onCancelAnalysis}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    {t.aiStates.cancel}
                  </button>
                </div>
              </div>
            ) : aiStatus === "canceled" ? (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 text-xs text-amber-800 dark:text-amber-300">
                <div className="flex items-center gap-2">
                  <XCircle className="w-4 h-4 shrink-0" />
                  <span>{aiError || t.aiStates.canceledMessage}</span>
                </div>
                <button
                  type="button"
                  onClick={onRunAnalysis}
                  className="px-3 py-1.5 bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 rounded font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/60 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {t.aiStates.retry}
                </button>
              </div>
            ) : aiStatus === "error" ? (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/70 text-xs text-red-700 dark:text-red-300">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>
                    {aiError ||
                      (aiErrorKind === "timeout"
                        ? t.aiStates.timeoutMessage
                        : t.aiStates.errorMessage)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onRunAnalysis}
                  className="px-3 py-1.5 bg-white dark:bg-slate-900 border border-red-200 dark:border-red-800 rounded font-medium text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/60 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {t.aiStates.retry}
                </button>
              </div>
            ) : aiStatus === "success" && aiAnalysis ? (
              <div className="space-y-6">
                <p className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
                  {aiAnalysis.executiveSummary}
                </p>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div className="space-y-3">
                    <h3 className="text-xs font-semibold text-[#0F294A] dark:text-slate-100">
                      {t.analyst.aiBottlenecks}
                    </h3>
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {bottlenecksList.map((b, i) => (
                        <div key={i} className="py-3 space-y-1 text-xs">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {b.title}
                          </div>
                          <div className="text-slate-700 dark:text-slate-300">
                            <span className="font-medium">{t.dashboard.brief.observation}:</span>{" "}
                            {b.observation}
                          </div>
                          <div className="text-slate-500 dark:text-slate-400">
                            <span className="font-medium text-slate-700 dark:text-slate-300">
                              {t.dashboard.brief.evidence}:
                            </span>{" "}
                            {b.evidence}
                          </div>
                          <div className="text-slate-600 dark:text-slate-300">
                            <span className="font-medium text-slate-700 dark:text-slate-200">
                              {t.dashboard.brief.impact}:
                            </span>{" "}
                            {b.impact}
                          </div>
                          <div className="text-blue-800 dark:text-blue-300 font-medium">
                            {t.dashboard.brief.action}: {b.action}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-xs font-semibold text-[#0F294A] dark:text-slate-100">
                      {t.analyst.rankedActions}
                    </h3>
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {rankedActionsList.map((act, idx) => (
                        <div key={idx} className="py-3 space-y-1 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {idx + 1}. {act.action}
                            </span>
                            <span className="font-mono-num text-[11px] text-blue-700 dark:text-blue-400 whitespace-nowrap">
                              {act.relatedProjectId} · {act.priority}
                            </span>
                          </div>
                          <div className="text-slate-600 dark:text-slate-300">{act.reason}</div>
                          <div className="text-slate-500 dark:text-slate-400">
                            <span className="font-medium text-slate-700 dark:text-slate-300">
                              {t.analyst.expectedImpact}:
                            </span>{" "}
                            {act.expectedImpact}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <p className="text-xs text-slate-600 dark:text-slate-300 max-w-2xl">
                  {t.analyst.promptCta}
                </p>
                <button
                  type="button"
                  onClick={onRunAnalysis}
                  disabled={isAnalyzing}
                  className="px-4 py-2 text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-900/60 disabled:opacity-60 border border-blue-200 dark:border-blue-800/70 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {t.analyst.runDeepAnalysis}
                </button>
              </div>
            )}
          </ErrorBoundary>
        </div>
      </section>

      {/* Deterministic Risk Register */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-[#0F294A] dark:text-blue-400" />
            <h2 className="text-sm font-semibold text-[#0F294A] dark:text-slate-100">
              {t.analyst.riskRegister}
            </h2>
          </div>
          <EpistemicTag kind="calculated" label={t.epistemic.calculatedMetric} />
        </div>

        {risks.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            {t.analyst.noActiveRisks}
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {risks.map((item) => {
              const title = language === "ar" ? item.project.titleAr : item.project.title;
              const obs = language === "ar" ? item.observationAr : item.observationEn;
              const ev = language === "ar" ? item.evidenceAr : item.evidenceEn;
              const rec = language === "ar" ? item.recommendedActionAr : item.recommendedActionEn;

              return (
                <div
                  key={item.project.id}
                  className="p-5 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                    <div className="space-y-2 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-3">
                        <RiskLevelLabel
                          level={item.riskLevel}
                          label={t.riskLevels[item.riskLevel]}
                        />
                        <button
                          type="button"
                          onClick={() => onInspectProject(item.project)}
                          className="text-sm font-semibold text-[#0F294A] dark:text-slate-100 hover:text-blue-700 dark:hover:text-blue-400 text-start cursor-pointer"
                        >
                          <span className="font-mono-num text-blue-700 dark:text-blue-400 me-1.5">
                            {item.project.id}
                          </span>
                          {title}
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1 text-xs">
                        <div>
                          <div className="text-slate-400 dark:text-slate-500 font-medium">
                            {t.analyst.mainReason}
                          </div>
                          <p className="text-slate-800 dark:text-slate-200 mt-0.5">{obs}</p>
                        </div>
                        <div>
                          <div className="text-slate-400 dark:text-slate-500 font-medium">
                            {t.analyst.supportingData}
                          </div>
                          <p className="text-slate-600 dark:text-slate-400 font-mono-num mt-0.5">
                            {ev}
                          </p>
                        </div>
                        <div>
                          <div className="text-slate-400 dark:text-slate-500 font-medium">
                            {t.analyst.recommendedAction}
                          </div>
                          <p className="text-blue-800 dark:text-blue-300 font-medium mt-0.5">
                            {rec}
                          </p>
                        </div>
                      </div>

                      {item.signals.length > 0 && (
                        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-400">
                          <span className="font-semibold text-slate-700 dark:text-slate-300 me-2">
                            {t.analyst.scoreBreakdown}:
                          </span>
                          {item.signals
                            .map(
                              (s) =>
                                `${language === "ar" ? s.detailAr : s.detailEn} (+${s.points})`
                            )
                            .join(" · ")}
                        </div>
                      )}

                      {(language === "ar" ? item.missingDataAr : item.missingDataEn).length > 0 && (
                        <div className="text-[11px] text-amber-800 dark:text-amber-300">
                          <span className="font-semibold me-1.5">{t.analyst.missingData}:</span>
                          {(language === "ar" ? item.missingDataAr : item.missingDataEn).join(" · ")}
                        </div>
                      )}
                    </div>

                    <div className="flex lg:flex-col items-center lg:items-end justify-between gap-1 shrink-0">
                      <div className="text-[11px] text-slate-400 dark:text-slate-500">
                        {t.analyst.riskScore}
                      </div>
                      <div className="text-xl font-bold font-mono-num text-[#0F294A] dark:text-slate-100">
                        {item.riskScore}
                        <span className="text-xs font-normal text-slate-400 dark:text-slate-500">
                          /100
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
});
