import React from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  PauseCircle,
  Sparkles,
  Database,
  Calculator,
  Compass,
} from "lucide-react";
import { PriorityLevel, ProjectStatus, RiskLevel } from "../types";

export const StatusLabel = React.memo(function StatusLabel({
  status,
  label,
}: {
  status: ProjectStatus;
  label: string;
}) {
  const styles: Record<ProjectStatus, { color: string; Icon: React.ElementType }> = {
    new: { color: "text-blue-700 dark:text-blue-400", Icon: Clock },
    in_progress: { color: "text-slate-800 dark:text-slate-200", Icon: Compass },
    under_review: { color: "text-amber-700 dark:text-amber-400", Icon: AlertCircle },
    completed: { color: "text-emerald-700 dark:text-emerald-400", Icon: CheckCircle2 },
    on_hold: { color: "text-slate-500 dark:text-slate-400", Icon: PauseCircle },
  };
  const { color, Icon } = styles[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${color}`}>
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span>{label}</span>
    </span>
  );
});

export const PriorityLabel = React.memo(function PriorityLabel({
  priority,
  label,
}: {
  priority: PriorityLevel;
  label: string;
}) {
  const styles: Record<PriorityLevel, { dot: string; text: string }> = {
    low: { dot: "bg-slate-400 dark:bg-slate-500", text: "text-slate-600 dark:text-slate-300" },
    medium: { dot: "bg-blue-600 dark:bg-blue-400", text: "text-blue-800 dark:text-blue-300" },
    high: { dot: "bg-amber-600 dark:bg-amber-400", text: "text-amber-800 dark:text-amber-300" },
    critical: {
      dot: "bg-red-600 dark:bg-red-400",
      text: "text-red-700 dark:text-red-300 font-semibold",
    },
  };
  const cfg = styles[priority];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-xs shrink-0 ${cfg.dot}`} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
});

export const RiskLevelLabel = React.memo(function RiskLevelLabel({
  level,
  label,
}: {
  level: RiskLevel;
  label: string;
}) {
  const styles: Record<RiskLevel, { text: string; bg: string; Icon: React.ElementType }> = {
    low: {
      text: "text-emerald-700 dark:text-emerald-300",
      bg: "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/70",
      Icon: CheckCircle2,
    },
    medium: {
      text: "text-blue-800 dark:text-blue-300",
      bg: "bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/70",
      Icon: Clock,
    },
    high: {
      text: "text-amber-800 dark:text-amber-300",
      bg: "bg-amber-50 dark:bg-amber-950/45 border-amber-200 dark:border-amber-800/70",
      Icon: AlertTriangle,
    },
    critical: {
      text: "text-red-800 dark:text-red-300",
      bg: "bg-red-50 dark:bg-red-950/45 border-red-200 dark:border-red-800/70",
      Icon: AlertCircle,
    },
  };
  const { text, bg, Icon } = styles[level];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-semibold rounded border whitespace-nowrap ${bg} ${text}`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span>{label}</span>
    </span>
  );
});

export const EpistemicTag = React.memo(function EpistemicTag({
  kind,
  label,
}: {
  kind: "confirmed" | "calculated" | "prediction" | "recommendation";
  label: string;
}) {
  const map = {
    confirmed: { Icon: Database, cls: "text-slate-600 dark:text-slate-400" },
    calculated: { Icon: Calculator, cls: "text-blue-700 dark:text-blue-400" },
    prediction: { Icon: Sparkles, cls: "text-indigo-700 dark:text-indigo-300" },
    recommendation: { Icon: Sparkles, cls: "text-blue-800 dark:text-blue-300" },
  };
  const { Icon, cls } = map[kind];
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium whitespace-nowrap ${cls}`}>
      <Icon className="w-3 h-3 shrink-0" />
      <span>{label}</span>
    </span>
  );
});
