import React, { useState } from "react";
import {
  EmployeeWorkloadSummary,
  Language,
  MonthlyTrendPoint,
  ProjectStatus,
  ServiceType,
} from "../types";
import { getCopy } from "../i18n/translations";

export const StatusDistributionChart = React.memo(function StatusDistributionChart({
  statusCounts,
  total,
  language,
}: {
  statusCounts: Record<ProjectStatus, number>;
  total: number;
  language: Language;
}) {
  const t = getCopy(language);
  const items: Array<{ key: ProjectStatus; bar: string }> = [
    { key: "in_progress", bar: "bg-blue-600 dark:bg-blue-500" },
    { key: "under_review", bar: "bg-amber-600 dark:bg-amber-500" },
    { key: "new", bar: "bg-[#0F294A] dark:bg-sky-400" },
    { key: "on_hold", bar: "bg-slate-400 dark:bg-slate-600" },
    { key: "completed", bar: "bg-emerald-600 dark:bg-emerald-500" },
  ];

  return (
    <div className="space-y-4">
      <div className="h-3 w-full rounded bg-slate-100 dark:bg-slate-800 overflow-hidden flex">
        {items.map((item) => {
          const count = statusCounts[item.key];
          const pct = total > 0 ? (count / total) * 100 : 0;
          if (pct === 0) return null;
          return (
            <div
              key={item.key}
              style={{ width: `${pct}%` }}
              className={`${item.bar} h-full`}
              title={`${t.statuses[item.key]}: ${count}`}
            />
          );
        })}
      </div>

      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {items.map((item) => {
          const count = statusCounts[item.key];
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          return (
            <div key={item.key} className="flex items-center justify-between py-2 text-sm">
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className={`w-2.5 h-2.5 rounded-xs shrink-0 ${item.bar}`}
                  aria-hidden="true"
                />
                <span className="text-slate-700 dark:text-slate-300 truncate">
                  {t.statuses[item.key]}
                </span>
              </div>
              <div className="flex items-center gap-3 font-mono-num text-xs">
                <span className="font-semibold text-slate-900 dark:text-slate-100">{count}</span>
                <span className="text-slate-500 dark:text-slate-400 w-10 text-end">{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

export const CompletionTrendChart = React.memo(function CompletionTrendChart({
  data,
  language,
}: {
  data: MonthlyTrendPoint[];
  language: Language;
}) {
  const t = getCopy(language);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const maxVal = Math.max(3, ...data.map((d) => d.completedCount));

  return (
    <div className="space-y-3">
      <div className="relative h-48 flex items-end gap-3 pt-6 pb-2 border-b border-slate-200 dark:border-slate-800">
        {data.map((point, idx) => {
          const onTimeH = Math.round((point.onTimeCount / maxVal) * 100);
          const delayedH = Math.round(
            (Math.max(0, point.completedCount - point.onTimeCount) / maxVal) * 100
          );
          const label = language === "ar" ? point.labelAr : point.labelEn;
          const isHovered = hoveredIdx === idx;

          return (
            <div
              key={point.monthKey}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              className="flex-1 h-full flex flex-col justify-end items-center relative group cursor-default"
            >
              {isHovered && (
                <div className="absolute -top-2 z-10 px-2.5 py-1.5 bg-[#0F294A] dark:bg-slate-800 text-white border border-transparent dark:border-slate-700 text-[11px] rounded shadow-md whitespace-nowrap pointer-events-none font-mono-num">
                  {label}: {point.completedCount} {t.dashboard.charts.projectsLabel}
                </div>
              )}
              <div className="w-full max-w-[36px] flex flex-col justify-end h-full gap-0.5">
                {delayedH > 0 && (
                  <div
                    style={{ height: `${delayedH}%` }}
                    className="w-full bg-amber-500 dark:bg-amber-400 rounded-t"
                  />
                )}
                {onTimeH > 0 && (
                  <div
                    style={{ height: `${onTimeH}%` }}
                    className={`w-full bg-[#2563EB] dark:bg-blue-500 ${delayedH === 0 ? "rounded-t" : ""}`}
                  />
                )}
                {point.completedCount === 0 && (
                  <div className="w-full h-1 bg-slate-200 dark:bg-slate-800 rounded-t" />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        {data.map((point) => (
          <div
            key={point.monthKey}
            className="flex-1 text-center text-xs text-slate-500 dark:text-slate-400"
          >
            {language === "ar" ? point.labelAr : point.labelEn}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-5 pt-1 text-xs text-slate-600 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-xs bg-[#2563EB] dark:bg-blue-500" />
          {t.performance.charts.onTime}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-xs bg-amber-500 dark:bg-amber-400" />
          {t.performance.charts.delayed}
        </span>
      </div>
    </div>
  );
});

export const TeamWorkloadChart = React.memo(function TeamWorkloadChart({
  workloads,
  language,
}: {
  workloads: EmployeeWorkloadSummary[];
  language: Language;
}) {
  const t = getCopy(language);

  return (
    <div className="space-y-3.5">
      {workloads.map((w) => {
        const name = language === "ar" ? w.employee.nameAr : w.employee.name;
        const barWidth = Math.min(100, w.utilizationPct);
        const barColor =
          w.capacityStatus === "overloaded"
            ? "bg-red-600 dark:bg-red-500"
            : w.capacityStatus === "available"
            ? "bg-emerald-600 dark:bg-emerald-500"
            : "bg-blue-600 dark:bg-blue-500";

        return (
          <div key={w.employee.id} className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                  {name}
                </span>
                <span className="text-slate-400 dark:text-slate-600">·</span>
                <span className="text-slate-500 dark:text-slate-400 font-mono-num whitespace-nowrap">
                  {w.activeProjectsCount} {t.dashboard.charts.projectsLabel}
                </span>
              </div>
              <div className="flex items-center gap-2 font-mono-num whitespace-nowrap">
                <span className="text-slate-700 dark:text-slate-300 font-medium">
                  {w.activeWorkloadHours}/{w.employee.weeklyCapacityHours}h
                </span>
                <span
                  className={
                    w.capacityStatus === "overloaded"
                      ? "text-red-700 dark:text-red-400 font-semibold"
                      : w.capacityStatus === "available"
                      ? "text-emerald-700 dark:text-emerald-400 font-semibold"
                      : "text-blue-800 dark:text-blue-400 font-semibold"
                  }
                >
                  {w.utilizationPct}%
                </span>
              </div>
            </div>
            <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
              <div style={{ width: `${barWidth}%` }} className={`h-full ${barColor}`} />
            </div>
          </div>
        );
      })}
    </div>
  );
});

export const CategoryBreakdownChart = React.memo(function CategoryBreakdownChart({
  categoryCounts,
  language,
}: {
  categoryCounts: Record<ServiceType, { total: number; delayed: number; completed: number }>;
  language: Language;
}) {
  const t = getCopy(language);
  const categories = Object.keys(categoryCounts) as ServiceType[];
  const maxTotal = Math.max(1, ...categories.map((c) => categoryCounts[c].total));

  return (
    <div className="space-y-3.5">
      {categories.map((cat) => {
        const entry = categoryCounts[cat];
        const totalPct = Math.round((entry.total / maxTotal) * 100);
        const delayedPct = entry.total > 0 ? Math.round((entry.delayed / entry.total) * totalPct) : 0;

        return (
          <div key={cat} className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-800 dark:text-slate-200">
                {t.services[cat]}
              </span>
              <span className="font-mono-num text-slate-600 dark:text-slate-400">
                {entry.total} {t.performance.charts.total} ·{" "}
                <span
                  className={
                    entry.delayed > 0
                      ? "text-red-700 dark:text-red-400 font-medium"
                      : "text-slate-500 dark:text-slate-400"
                  }
                >
                  {entry.delayed} {t.performance.charts.delayed}
                </span>
              </span>
            </div>
            <div className="h-2.5 w-full bg-slate-100 dark:bg-slate-800 rounded overflow-hidden flex">
              <div
                style={{ width: `${Math.max(0, totalPct - delayedPct)}%` }}
                className="h-full bg-[#0F294A] dark:bg-blue-500"
              />
              {delayedPct > 0 && (
                <div
                  style={{ width: `${delayedPct}%` }}
                  className="h-full bg-red-500 dark:bg-red-400"
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
});

export const DelayAndWorkloadTrendChart = React.memo(function DelayAndWorkloadTrendChart({
  data,
  mode,
  language,
}: {
  data: MonthlyTrendPoint[];
  mode: "delays" | "workload";
  language: Language;
}) {
  const t = getCopy(language);
  const maxVal = Math.max(
    1,
    ...data.map((d) => (mode === "delays" ? Math.max(d.completedCount, d.delayedCount) : d.totalHours))
  );

  return (
    <div className="space-y-3">
      <div className="h-44 flex items-end gap-3 pt-4 pb-2 border-b border-slate-200 dark:border-slate-800">
        {data.map((point) => {
          const valA = mode === "delays" ? point.completedCount : point.totalHours;
          const valB = mode === "delays" ? point.delayedCount : 0;
          const hA = Math.round((valA / maxVal) * 100);
          const hB = Math.round((valB / maxVal) * 100);

          return (
            <div key={point.monthKey} className="flex-1 h-full flex items-end justify-center gap-1">
              <div className="flex flex-col items-center justify-end h-full flex-1 max-w-[22px]">
                <span className="text-[10px] font-mono-num text-slate-500 dark:text-slate-400 mb-1">
                  {valA > 0 ? valA : ""}
                </span>
                <div
                  style={{ height: `${Math.max(valA > 0 ? 6 : 2, hA)}%` }}
                  className={`w-full rounded-t ${
                    mode === "delays"
                      ? "bg-blue-600 dark:bg-blue-500"
                      : "bg-[#0F294A] dark:bg-sky-400"
                  }`}
                />
              </div>
              {mode === "delays" && (
                <div className="flex flex-col items-center justify-end h-full flex-1 max-w-[22px]">
                  <span className="text-[10px] font-mono-num text-red-600 dark:text-red-400 mb-1">
                    {valB > 0 ? valB : ""}
                  </span>
                  <div
                    style={{ height: `${Math.max(valB > 0 ? 6 : 2, hB)}%` }}
                    className="w-full rounded-t bg-red-500 dark:bg-red-400"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        {data.map((point) => (
          <div
            key={point.monthKey}
            className="flex-1 text-center text-xs text-slate-500 dark:text-slate-400"
          >
            {language === "ar" ? point.labelAr : point.labelEn}
          </div>
        ))}
      </div>
      {mode === "delays" && (
        <div className="flex items-center gap-5 text-xs text-slate-600 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-blue-600 dark:bg-blue-500" />
            {t.performance.kpi.completed}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-red-500 dark:bg-red-400" />
            {t.performance.charts.delayed}
          </span>
        </div>
      )}
    </div>
  );
});
