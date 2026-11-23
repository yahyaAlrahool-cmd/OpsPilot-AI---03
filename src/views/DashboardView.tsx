import React from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  FolderKanban,
  Info,
  Layers,
  Radar,
  RefreshCw,
  Sparkles,
  TimerOff,
  TrendingUp,
  XCircle,
} from "lucide-react";
import {
  AIErrorKind,
  AIRequestStatus,
  DailyBriefResponse,
  EmployeeWorkloadSummary,
  Language,
  NavSection,
  OperationalIntelligenceReport,
  OperationalMetrics,
  Project,
} from "../types";
import { getCopy } from "../i18n/translations";
import {
  CompletionTrendChart,
  StatusDistributionChart,
  TeamWorkloadChart,
} from "../components/Charts";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { EpistemicTag, RiskLevelLabel } from "../components/StatusIndicator";
import { METRIC_FORMULAS } from "../utils/analytics";

interface DashboardViewProps {
  language: Language;
  metrics: OperationalMetrics;
  workloads: EmployeeWorkloadSummary[];
  intelligence: OperationalIntelligenceReport;
  brief: DailyBriefResponse | null;
  briefStatus: AIRequestStatus;
  briefErrorKind: AIErrorKind | null;
  briefError: string | null;
  onRefreshBrief: () => void;
  onCancelBrief: () => void;
  onNavigate: (section: NavSection) => void;
  onInspectProject: (project: Project) => void;
}

export const DashboardView = React.memo(function DashboardView({
  language,
  metrics,
  workloads,
  intelligence,
  brief,
  briefStatus,
  briefErrorKind,
  briefError,
  onRefreshBrief,
  onCancelBrief,
  onNavigate,
  onInspectProject,
}: DashboardViewProps) {
  const t = getCopy(language);
  const formulas = METRIC_FORMULAS[language];
  const immediateList = intelligence.immediateAttention;
  const proactiveList = intelligence.proactiveInsights;
  const isAnalyzing = briefStatus === "analyzing";

  const kpiCards = [
    {
      label: t.dashboard.kpi.totalOrders,
      value: metrics.totalOrders,
      Icon: Layers,
      accent: "text-[#0F294A] dark:text-slate-100",
      sub: t.epistemic.confirmedData,
      formula: "",
    },
    {
      label: t.dashboard.kpi.activeProjects,
      value: metrics.activeProjects,
      Icon: FolderKanban,
      accent: "text-blue-700 dark:text-blue-400",
      sub: t.epistemic.calculatedMetric,
      formula: formulas.activeProjects,
    },
    {
      label: t.dashboard.kpi.completedProjects,
      value: metrics.completedProjects,
      Icon: CheckCircle2,
      accent: "text-emerald-700 dark:text-emerald-400",
      sub: t.epistemic.confirmedData,
      formula: "",
    },
    {
      label: t.dashboard.kpi.overdueProjects,
      value: metrics.overdueProjects,
      Icon: TimerOff,
      accent:
        metrics.overdueProjects > 0
          ? "text-red-700 dark:text-red-400"
          : "text-slate-700 dark:text-slate-300",
      sub: t.epistemic.calculatedMetric,
      formula: formulas.overdueProjects,
    },
    {
      label: t.dashboard.kpi.atRiskProjects,
      value: metrics.atRiskProjects,
      Icon: AlertTriangle,
      accent:
        metrics.atRiskProjects > 0
          ? "text-amber-700 dark:text-amber-400"
          : "text-slate-700 dark:text-slate-300",
      sub: t.epistemic.calculatedMetric,
      formula: formulas.atRiskProjects,
    },
    {
      label: t.dashboard.kpi.completionRate,
      value: `${metrics.completionRate}%`,
      Icon: TrendingUp,
      accent: "text-blue-800 dark:text-sky-400",
      sub: `${metrics.completedProjects}/${metrics.totalOrders}`,
      formula: formulas.completionRate,
    },
  ];

  const attentionList = Array.isArray(brief?.attentionToday) ? brief.attentionToday : [];
  const prioritiesList = Array.isArray(brief?.recommendedPriorities)
    ? brief.recommendedPriorities
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0F294A] dark:text-slate-100">
            {t.dashboard.title}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t.dashboard.subtitle}</p>
        </div>
        <div className="inline-flex flex-wrap items-center gap-4 px-3.5 py-2 rounded-lg bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 text-xs shrink-0">
          <div>
            <span className="text-slate-500 dark:text-slate-400 me-1.5">
              {t.dashboard.kpi.portfolioBudget}:
            </span>
            <span className="font-mono-num font-bold text-[#0F294A] dark:text-slate-100">
              ${metrics.totalPortfolioBudget.toLocaleString("en-US")}
            </span>
          </div>
          <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">|</span>
          <div>
            <span className="text-slate-500 dark:text-slate-400 me-1.5">
              {t.dashboard.kpi.activeBudget}:
            </span>
            <span className="font-mono-num font-bold text-blue-700 dark:text-blue-400">
              ${metrics.activePortfolioBudget.toLocaleString("en-US")}
            </span>
          </div>
        </div>
      </div>

      {/* KPI Grid */}
      <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {kpiCards.map((kpi) => (
          <div
            key={kpi.label}
            title={kpi.formula || undefined}
            className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col justify-between gap-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400 leading-snug">
                {kpi.label}
              </span>
              <kpi.Icon className={`w-4 h-4 shrink-0 ${kpi.accent}`} />
            </div>
            <div>
              <div className={`text-2xl font-bold font-mono-num ${kpi.accent}`}>{kpi.value}</div>
              <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 font-mono-num">
                {kpi.sub}
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* Requires Immediate Attention — Command Center Triage */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[#0F294A] dark:text-slate-100">
              {t.dashboard.alerts.title}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t.dashboard.alerts.subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate("analyst")}
            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 whitespace-nowrap cursor-pointer"
          >
            <span>{t.dashboard.alerts.viewAll}</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {immediateList.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            {t.dashboard.alerts.noAlerts}
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {immediateList.map((item) => {
              const title = language === "ar" ? item.project.titleAr : item.project.title;
              const owner = language === "ar" ? item.ownerNameAr : item.ownerName;
              const blocker = language === "ar" ? item.blockerAr : item.blockerEn;
              const why = language === "ar" ? item.whyItMattersAr : item.whyItMattersEn;
              const rec = language === "ar" ? item.recommendedActionAr : item.recommendedActionEn;
              const deltaText =
                item.daysUntilDeadline < 0
                  ? `${Math.abs(item.daysUntilDeadline)}${t.dashboard.alerts.daysOverdue}`
                  : item.daysUntilDeadline === 0
                  ? t.dashboard.alerts.dueToday
                  : `${item.daysUntilDeadline}${t.dashboard.alerts.daysLeft}`;

              return (
                <div
                  key={item.projectId}
                  className="px-6 py-4 flex flex-col lg:flex-row lg:items-start justify-between gap-4 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <div className="space-y-2 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <RiskLevelLabel
                        level={item.riskLevel}
                        label={`${t.riskLevels[item.riskLevel]} (${item.riskScore})`}
                      />
                      <button
                        type="button"
                        onClick={() => onInspectProject(item.project)}
                        className="text-sm font-semibold text-[#0F294A] dark:text-slate-100 hover:text-blue-700 dark:hover:text-blue-400 text-start cursor-pointer"
                      >
                        <span className="font-mono-num text-blue-700 dark:text-blue-400 me-1.5">
                          {item.projectId}
                        </span>
                        {title}
                      </button>
                      <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                        {owner} ({item.ownerUtilizationPct}%)
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                      <p className="text-slate-700 dark:text-slate-300">
                        <span className="font-medium text-slate-900 dark:text-slate-100">
                          {t.dashboard.alerts.whyItMatters}:
                        </span>{" "}
                        {why}
                      </p>
                      <p
                        className={
                          item.hasRecordedBlocker
                            ? "text-slate-600 dark:text-slate-400"
                            : "text-amber-700 dark:text-amber-300"
                        }
                      >
                        <span className="font-medium text-slate-800 dark:text-slate-200">
                          {t.dashboard.alerts.blocker}:
                        </span>{" "}
                        {blocker}
                      </p>
                    </div>

                    <p className="text-xs text-blue-800 dark:text-blue-300 font-medium">
                      <span className="text-slate-700 dark:text-slate-300 font-semibold">
                        {t.dashboard.alerts.recommended}:
                      </span>{" "}
                      {rec}
                    </p>
                  </div>

                  <div className="flex lg:flex-col items-center lg:items-end justify-between gap-2 shrink-0">
                    <div className="text-end">
                      <div className="text-[11px] text-slate-400 dark:text-slate-500">
                        {t.dashboard.alerts.deadline}
                      </div>
                      <div
                        className={`text-xs font-mono-num font-semibold ${
                          item.daysUntilDeadline < 0
                            ? "text-red-700 dark:text-red-400"
                            : "text-slate-800 dark:text-slate-200"
                        }`}
                      >
                        {item.project.deadline}
                      </div>
                      <div
                        className={`text-[11px] font-mono-num ${
                          item.daysUntilDeadline < 0
                            ? "text-red-600 dark:text-red-400"
                            : "text-amber-700 dark:text-amber-400"
                        }`}
                      >
                        {deltaText} · {item.remainingWorkloadHours}
                        {t.projects.hoursSuffix}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Operational Intelligence (Proactive Grounded Patterns) */}
      {proactiveList.length > 0 && (
        <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Radar className="w-4 h-4 text-blue-700 dark:text-blue-400 shrink-0" />
              <div>
                <h2 className="text-sm font-semibold text-[#0F294A] dark:text-slate-100">
                  {t.dashboard.intelligence.title}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {t.dashboard.intelligence.subtitle}
                </p>
              </div>
            </div>
            <EpistemicTag kind="calculated" label={t.epistemic.calculatedMetric} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x md:rtl:divide-x-reverse divide-slate-100 dark:divide-slate-800">
            {proactiveList.map((insight, idx) => {
              const Icon =
                insight.severity === "critical"
                  ? AlertCircle
                  : insight.severity === "warning"
                  ? AlertTriangle
                  : Info;
              const iconTone =
                insight.severity === "critical"
                  ? "text-red-600 dark:text-red-400"
                  : insight.severity === "warning"
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-blue-600 dark:text-blue-400";

              return (
                <div
                  key={insight.id}
                  className={`p-5 space-y-1.5 ${
                    idx >= 2 ? "md:border-t md:border-slate-100 md:dark:border-slate-800" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Icon className={`w-4 h-4 shrink-0 ${iconTone}`} />
                    <h3 className="text-xs font-semibold text-[#0F294A] dark:text-slate-100">
                      {language === "ar" ? insight.titleAr : insight.titleEn}
                    </h3>
                  </div>
                  <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                    {language === "ar" ? insight.detailAr : insight.detailEn}
                  </p>
                  <div className="text-[11px] font-mono-num text-slate-500 dark:text-slate-400">
                    {language === "ar" ? insight.evidenceAr : insight.evidenceEn}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* AI Daily Brief */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 bg-[#0F294A] dark:bg-[#162033] text-white border-b border-transparent dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-blue-300 shrink-0" />
            <div>
              <h2 className="text-sm font-semibold">{t.dashboard.brief.title}</h2>
              <p className="text-xs text-slate-300">{t.dashboard.brief.subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isAnalyzing && (
              <button
                type="button"
                onClick={onCancelBrief}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-600 transition-colors whitespace-nowrap cursor-pointer"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span>{t.aiStates.cancel}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onRefreshBrief}
              disabled={isAnalyzing}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isAnalyzing ? "animate-spin" : ""}`} />
              <span>{brief ? t.dashboard.brief.refresh : t.dashboard.brief.generate}</span>
            </button>
          </div>
        </div>

        <div className="p-6">
          <ErrorBoundary variant="panel" language={language} onRetry={onRefreshBrief}>
            {briefStatus === "analyzing" ? (
              <div className="space-y-4 animate-pulse">
                <div className="h-4 bg-slate-100 dark:bg-slate-800 rounded w-3/4" />
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-2">
                  <div className="h-24 bg-slate-100 dark:bg-slate-800 rounded-lg" />
                  <div className="h-24 bg-slate-100 dark:bg-slate-800 rounded-lg" />
                  <div className="h-24 bg-slate-100 dark:bg-slate-800 rounded-lg" />
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t.dashboard.brief.generating}
                </p>
              </div>
            ) : briefStatus === "canceled" ? (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3 text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 rounded-lg px-4">
                <div className="flex items-center gap-2">
                  <XCircle className="w-4 h-4 shrink-0" />
                  <span>{briefError || t.aiStates.canceledMessage}</span>
                </div>
                <button
                  type="button"
                  onClick={onRefreshBrief}
                  className="px-3 py-1.5 text-xs font-medium bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 rounded-md text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {t.aiStates.retry}
                </button>
              </div>
            ) : briefStatus === "error" ? (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/70 rounded-lg px-4">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>
                    {briefError ||
                      (briefErrorKind === "timeout"
                        ? t.aiStates.timeoutMessage
                        : t.aiStates.errorMessage)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onRefreshBrief}
                  className="px-3 py-1.5 text-xs font-medium bg-white dark:bg-slate-900 border border-red-200 dark:border-red-800 rounded-md text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {t.aiStates.retry}
                </button>
              </div>
            ) : brief ? (
              <div className="space-y-6" dir={language === "ar" ? "rtl" : "ltr"}>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 divide-y lg:divide-y-0 lg:divide-x lg:rtl:divide-x-reverse divide-slate-100 dark:divide-slate-800">
                  <div className="space-y-1.5 pt-2 lg:pt-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                        {t.dashboard.brief.overallStatus}
                      </span>
                      <EpistemicTag kind="calculated" label={t.epistemic.aiSynthesis} />
                    </div>
                    <p className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
                      {brief.overallStatus}
                    </p>
                  </div>

                  <div className="space-y-1.5 pt-4 lg:pt-0 lg:ps-6">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-red-700 dark:text-red-400">
                        {t.dashboard.brief.mostUrgent}
                      </span>
                      <EpistemicTag kind="confirmed" label={t.epistemic.confirmedData} />
                    </div>
                    <p className="text-sm text-slate-900 dark:text-slate-100 font-medium leading-relaxed">
                      {brief.mostUrgentIssue}
                    </p>
                  </div>

                  <div className="space-y-1.5 pt-4 lg:pt-0 lg:ps-6">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                        {t.dashboard.brief.workloadConcerns}
                      </span>
                      <EpistemicTag kind="calculated" label={t.epistemic.calculatedMetric} />
                    </div>
                    <p className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
                      {brief.workloadConcerns}
                    </p>
                  </div>
                </div>

                <div className="border-t border-slate-100 dark:border-slate-800 pt-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <h3 className="text-xs font-semibold text-[#0F294A] dark:text-slate-100">
                      {t.dashboard.brief.attentionToday}
                    </h3>
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {attentionList.map((item, idx) => (
                        <div
                          key={`${item.projectId}-${idx}`}
                          className="py-2.5 flex items-start justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                              <span className="font-mono-num text-xs text-blue-700 dark:text-blue-400">
                                {item.projectId}
                              </span>
                              <span className="truncate">{item.projectTitle}</span>
                            </div>
                            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                              {item.reason}
                            </p>
                          </div>
                          <span className="text-xs font-mono-num text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
                            {item.deadline}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold text-[#0F294A] dark:text-slate-100">
                        {t.dashboard.brief.prioritiesToday}
                      </h3>
                      <EpistemicTag kind="recommendation" label={t.epistemic.aiRecommendation} />
                    </div>
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {prioritiesList.map((rec, i) => (
                        <div key={i} className="py-2.5 space-y-1 text-xs">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {rec.action}
                          </div>
                          <div className="text-slate-600 dark:text-slate-300">
                            <span className="font-medium text-slate-700 dark:text-slate-200">
                              {t.dashboard.brief.observation}:
                            </span>{" "}
                            {rec.observation}
                          </div>
                          <div className="text-slate-500 dark:text-slate-400">
                            <span className="font-medium text-slate-700 dark:text-slate-300">
                              {t.dashboard.brief.evidence}:
                            </span>{" "}
                            {rec.evidence} ·{" "}
                            <span className="font-medium text-slate-700 dark:text-slate-300">
                              {t.dashboard.brief.impact}:
                            </span>{" "}
                            {rec.impact}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </ErrorBoundary>
        </div>
      </section>

      {/* Dashboard Charts */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[#0F294A] dark:text-slate-100">
              {t.dashboard.charts.ordersByStatus}
            </h2>
            <EpistemicTag kind="confirmed" label={t.epistemic.confirmedData} />
          </div>
          <StatusDistributionChart
            statusCounts={metrics.statusCounts}
            total={metrics.totalOrders}
            language={language}
          />
        </div>

        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[#0F294A] dark:text-slate-100">
              {t.dashboard.charts.completedOverTime}
            </h2>
            <EpistemicTag kind="confirmed" label={t.epistemic.confirmedData} />
          </div>
          <CompletionTrendChart data={metrics.monthlyTrends} language={language} />
        </div>

        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[#0F294A] dark:text-slate-100">
              {t.dashboard.charts.teamWorkloadDist}
            </h2>
            <EpistemicTag kind="calculated" label={t.epistemic.calculatedMetric} />
          </div>
          <TeamWorkloadChart workloads={workloads} language={language} />
        </div>
      </section>
    </div>
  );
});
