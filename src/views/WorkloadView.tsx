import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRightLeft, CheckCircle2, Info, Users } from "lucide-react";
import {
  EmployeeWorkloadSummary,
  Language,
  OperationalIntelligenceReport,
  Project,
  RebalanceSuggestion,
} from "../types";
import { getCopy } from "../i18n/translations";
import { EpistemicTag } from "../components/StatusIndicator";

interface WorkloadViewProps {
  language: Language;
  workloads: EmployeeWorkloadSummary[];
  suggestions: RebalanceSuggestion[];
  intelligence: OperationalIntelligenceReport;
  onReassignProject: (projectId: string, toEmployeeId: string) => void;
  onInspectProject: (project: Project) => void;
}

export const WorkloadView = React.memo(function WorkloadView({
  language,
  workloads,
  suggestions,
  intelligence,
  onReassignProject,
  onInspectProject,
}: WorkloadViewProps) {
  const t = getCopy(language);
  const [recentNotice, setRecentNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, []);

  const overloaded = workloads.filter((w) => w.capacityStatus === "overloaded");
  const available = workloads.filter((w) => w.capacityStatus === "available");

  const handleApply = (s: RebalanceSuggestion) => {
    onReassignProject(s.projectId, s.toEmployeeId);
    setRecentNotice(`${s.projectId}: ${t.workload.appliedNote}`);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setRecentNotice(null), 4000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[#0F294A] dark:text-slate-100">
          {t.workload.title}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t.workload.subtitle}</p>
      </div>

      {/* Capacity Intelligence Summary */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Info className="w-4 h-4 text-blue-700 dark:text-blue-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <div className="text-xs font-semibold text-[#0F294A] dark:text-slate-100">
              {t.workload.intelligenceTitle}
            </div>
            <p className="text-xs text-slate-700 dark:text-slate-300">
              {language === "ar"
                ? intelligence.capacityRebalanceNarrativeAr
                : intelligence.capacityRebalanceNarrativeEn}
            </p>
          </div>
        </div>
        <EpistemicTag kind="calculated" label={t.epistemic.calculatedMetric} />
      </section>

      {/* Overload & Available Summary Banner */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <AlertTriangle
              className={`w-5 h-5 shrink-0 ${
                overloaded.length > 0
                  ? "text-red-600 dark:text-red-400"
                  : "text-slate-400 dark:text-slate-500"
              }`}
            />
            <div>
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                {t.workload.overloadedAlert}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {overloaded.length > 0
                  ? overloaded
                      .map((w) =>
                        language === "ar"
                          ? `${w.employee.nameAr} (${w.utilizationPct}%)`
                          : `${w.employee.name} (${w.utilizationPct}%)`
                      )
                      .join(" · ")
                  : "—"}
              </div>
            </div>
          </div>
          <span className="font-mono-num text-lg font-bold text-red-700 dark:text-red-400">
            {overloaded.length}
          </span>
        </div>

        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div>
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                {t.workload.availableAlert}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {available.length > 0
                  ? available
                      .map((w) =>
                        language === "ar"
                          ? `${w.employee.nameAr} (${w.utilizationPct}%)`
                          : `${w.employee.name} (${w.utilizationPct}%)`
                      )
                      .join(" · ")
                  : "—"}
              </div>
            </div>
          </div>
          <span className="font-mono-num text-lg font-bold text-emerald-700 dark:text-emerald-400">
            {available.length}
          </span>
        </div>
      </section>

      {/* Team Member Workload Grid */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {workloads.map((w) => {
          const name = language === "ar" ? w.employee.nameAr : w.employee.name;
          const role = language === "ar" ? w.employee.roleAr : w.employee.role;
          const department = language === "ar" ? w.employee.departmentAr : w.employee.department;
          const activeProjects = w.assignedProjects.filter((p) => p.status !== "completed");

          const statusStyles =
            w.capacityStatus === "overloaded"
              ? "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/45 border-red-200 dark:border-red-800/70"
              : w.capacityStatus === "available"
              ? "text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/45 border-emerald-200 dark:border-emerald-800/70"
              : "text-blue-800 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/45 border-blue-200 dark:border-blue-800/70";

          const barColor =
            w.capacityStatus === "overloaded"
              ? "bg-red-600 dark:bg-red-500"
              : w.capacityStatus === "available"
              ? "bg-emerald-600 dark:bg-emerald-500"
              : "bg-blue-600 dark:bg-blue-500";

          return (
            <div
              key={w.employee.id}
              className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-[#0F294A] dark:text-slate-100">
                    {name}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {role}
                    {department ? (
                      <span className="text-blue-700 dark:text-blue-400 font-medium">
                        {" "}· {department}
                      </span>
                    ) : null}
                  </p>
                </div>
                <span
                  className={`px-2.5 py-1 text-xs font-semibold rounded border whitespace-nowrap ${statusStyles}`}
                >
                  {t.capacityStatus[w.capacityStatus]}
                </span>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400">
                    {t.workload.activeHours}:{" "}
                    <span className="font-mono-num font-semibold text-slate-800 dark:text-slate-200">
                      {w.activeWorkloadHours}h
                    </span>{" "}
                    / {w.employee.weeklyCapacityHours}h
                  </span>
                  <span className="font-mono-num font-bold text-[#0F294A] dark:text-slate-100">
                    {w.utilizationPct}%
                  </span>
                </div>
                <div className="h-2.5 w-full bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
                  <div
                    style={{ width: `${Math.min(100, w.utilizationPct)}%` }}
                    className={`h-full ${barColor}`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 py-3 border-y border-slate-100 dark:border-slate-800 text-center">
                <div>
                  <div className="text-[11px] text-slate-400 dark:text-slate-500">
                    {t.workload.activeTasks}
                  </div>
                  <div className="text-base font-bold font-mono-num text-slate-900 dark:text-slate-100">
                    {w.activeProjectsCount}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 dark:text-slate-500">
                    {t.workload.completedTasks}
                  </div>
                  <div className="text-base font-bold font-mono-num text-emerald-700 dark:text-emerald-400">
                    {w.completedProjectsCount}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 dark:text-slate-500">
                    {t.workload.overdueTasks}
                  </div>
                  <div
                    className={`text-base font-bold font-mono-num ${
                      w.overdueProjectsCount > 0
                        ? "text-red-700 dark:text-red-400"
                        : "text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    {w.overdueProjectsCount}
                  </div>
                </div>
              </div>

              <div className="text-xs">
                <span className="text-slate-400 dark:text-slate-500 font-medium">
                  {w.employee.skillsVerified ? t.workload.skillsLabel : t.workload.unverifiedSkills}:{" "}
                </span>
                <span className="text-slate-700 dark:text-slate-300">
                  {w.employee.skills.map((s) => t.services[s]).join(" · ")}
                </span>
              </div>

              {activeProjects.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <div className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                    {t.workload.assignedProjects}
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {activeProjects.map((p) => (
                      <div
                        key={p.id}
                        className="py-1.5 flex items-center justify-between gap-2 text-xs"
                      >
                        <button
                          type="button"
                          onClick={() => onInspectProject(p)}
                          className="text-slate-800 dark:text-slate-200 hover:text-blue-700 dark:hover:text-blue-400 truncate text-start cursor-pointer"
                        >
                          <span className="font-mono-num text-blue-700 dark:text-blue-400 me-1.5">
                            {p.id}
                          </span>
                          {language === "ar" ? p.titleAr : p.title}
                        </button>
                        <span className="font-mono-num text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
                          {p.progress}% · {p.deadline}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* Rebalancing Recommendations */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-[#0F294A] dark:text-blue-400" />
            <div>
              <h2 className="text-sm font-semibold text-[#0F294A] dark:text-slate-100">
                {t.workload.rebalanceTitle}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t.workload.rebalanceSubtitle} · {t.workload.reversibleNote}
              </p>
            </div>
          </div>
          <EpistemicTag kind="recommendation" label={t.epistemic.aiRecommendation} />
        </div>

        {recentNotice && (
          <div className="mx-6 mt-4 px-4 py-2.5 bg-emerald-50 dark:bg-emerald-950/45 border border-emerald-200 dark:border-emerald-800/70 rounded-lg text-xs font-medium text-emerald-800 dark:text-emerald-300">
            {recentNotice}
          </div>
        )}

        {suggestions.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            {t.workload.noRebalance}
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {suggestions.map((s) => (
              <div
                key={`${s.projectId}-${s.toEmployeeId}`}
                className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
              >
                <div className="space-y-1.5 flex-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="font-mono-num text-xs font-semibold text-blue-700 dark:text-blue-400">
                      {s.projectId}
                    </span>
                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {language === "ar" ? s.projectTitleAr : s.projectTitle}
                    </span>
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${
                        s.requiresManagerVerification
                          ? "bg-amber-50 dark:bg-amber-950/45 border-amber-200 dark:border-amber-800/70 text-amber-800 dark:text-amber-300"
                          : "bg-emerald-50 dark:bg-emerald-950/45 border-emerald-200 dark:border-emerald-800/70 text-emerald-800 dark:text-emerald-300"
                      }`}
                    >
                      {s.requiresManagerVerification
                        ? t.workload.verificationBadge
                        : t.workload.skillVerifiedBadge}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    {language === "ar" ? s.reasonAr : s.reasonEn}
                  </p>
                  <div className="text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                    {language === "ar" ? s.fromEmployeeNameAr : s.fromEmployeeName} →{" "}
                    {language === "ar" ? s.toEmployeeNameAr : s.toEmployeeName} (~{s.hoursMoved}h)
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleApply(s)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-900/60 border border-blue-200 dark:border-blue-800/70 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                  <span>{t.workload.applyReassign}</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
});
