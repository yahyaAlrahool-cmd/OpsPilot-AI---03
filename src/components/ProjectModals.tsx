import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  Employee,
  Language,
  PriorityLevel,
  Project,
  ProjectRiskAssessment,
  ProjectStatus,
  ServiceType,
} from "../types";
import { getCopy } from "../i18n/translations";
import { PriorityLabel, RiskLevelLabel, StatusLabel } from "./StatusIndicator";
import { diffDays, extractProjectBlocker, getTodayISO } from "../utils/analytics";

interface ProjectFormModalProps {
  open: boolean;
  language: Language;
  employees: Employee[];
  initialProject: Project | null;
  onClose: () => void;
  onSave: (projectData: Omit<Project, "id" | "lastUpdated">, existingId?: string) => void;
}

const SERVICE_TYPES: ServiceType[] = [
  "research_reports",
  "presentations",
  "graphic_design",
  "website_development",
  "business_services",
];

const STATUSES: ProjectStatus[] = [
  "new",
  "in_progress",
  "under_review",
  "completed",
  "on_hold",
];

const PRIORITIES: PriorityLevel[] = ["low", "medium", "high", "critical"];

export function ProjectFormModal({
  open,
  language,
  employees,
  initialProject,
  onClose,
  onSave,
}: ProjectFormModalProps) {
  const t = getCopy(language);
  const [title, setTitle] = useState("");
  const [clientName, setClientName] = useState("");
  const [serviceType, setServiceType] = useState<ServiceType>("business_services");
  const [assignedEmployeeId, setAssignedEmployeeId] = useState(employees[0]?.id ?? "EMP-01");
  const [startDate, setStartDate] = useState(getTodayISO());
  const [deadline, setDeadline] = useState(getTodayISO());
  const [status, setStatus] = useState<ProjectStatus>("new");
  const [progress, setProgress] = useState(0);
  const [priority, setPriority] = useState<PriorityLevel>("medium");
  const [estimatedWorkload, setEstimatedWorkload] = useState(16);
  const [budget, setBudget] = useState<string>("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    if (initialProject) {
      setTitle(language === "ar" ? initialProject.titleAr : initialProject.title);
      setClientName(language === "ar" ? initialProject.clientNameAr : initialProject.clientName);
      setServiceType(initialProject.serviceType);
      setAssignedEmployeeId(initialProject.assignedEmployeeId);
      setStartDate(initialProject.startDate);
      setDeadline(initialProject.deadline);
      setStatus(initialProject.status);
      setProgress(initialProject.progress);
      setPriority(initialProject.priority);
      setEstimatedWorkload(initialProject.estimatedWorkload);
      setBudget(
        typeof initialProject.budget === "number" && Number.isFinite(initialProject.budget)
          ? String(initialProject.budget)
          : ""
      );
      setNotes(language === "ar" ? initialProject.notesAr : initialProject.notes);
    } else {
      const today = getTodayISO();
      const plusTen = new Date();
      plusTen.setDate(plusTen.getDate() + 10);
      setTitle("");
      setClientName("");
      setServiceType("business_services");
      setAssignedEmployeeId(employees[0]?.id ?? "EMP-01");
      setStartDate(today);
      setDeadline(plusTen.toISOString().slice(0, 10));
      setStatus("new");
      setProgress(0);
      setPriority("medium");
      setEstimatedWorkload(16);
      setBudget("");
      setNotes("");
    }
  }, [open, initialProject, employees, language]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !clientName.trim()) return;
    const finalProgress = status === "completed" ? 100 : Math.min(100, Math.max(0, progress));
    const completedDate =
      status === "completed" ? initialProject?.completedDate ?? getTodayISO() : undefined;

    const parsedBudgetRaw = budget.trim() === "" ? undefined : Number(budget);
    const normalizedBudget =
      parsedBudgetRaw !== undefined && Number.isFinite(parsedBudgetRaw) && parsedBudgetRaw >= 0
        ? Math.round(Math.min(10_000_000, parsedBudgetRaw))
        : undefined;

    onSave(
      {
        title: language === "en" ? title.trim() : initialProject?.title || title.trim(),
        titleAr: language === "ar" ? title.trim() : initialProject?.titleAr || title.trim(),
        clientName:
          language === "en" ? clientName.trim() : initialProject?.clientName || clientName.trim(),
        clientNameAr:
          language === "ar"
            ? clientName.trim()
            : initialProject?.clientNameAr || clientName.trim(),
        serviceType,
        assignedEmployeeId,
        startDate,
        deadline,
        completedDate,
        status,
        progress: finalProgress,
        priority,
        estimatedWorkload: Math.max(1, Number(estimatedWorkload) || 1),
        ...(normalizedBudget !== undefined ? { budget: normalizedBudget } : {}),
        notes: language === "en" ? notes.trim() : initialProject?.notes || notes.trim(),
        notesAr: language === "ar" ? notes.trim() : initialProject?.notesAr || notes.trim(),
      },
      initialProject?.id
    );
  };

  const inputClass =
    "w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-[#0B1120] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600";

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-black/70 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-base font-bold text-[#0F294A] dark:text-slate-100">
            {initialProject ? t.projects.editTitle : t.projects.createTitle}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.projects.form.close}
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="space-y-1.5 block">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                {t.projects.form.title} *
              </span>
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="space-y-1.5 block">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                {t.projects.form.client} *
              </span>
              <input
                required
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className={inputClass}
              />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="space-y-1.5 block">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                {t.projects.form.service}
              </span>
              <select
                value={serviceType}
                onChange={(e) => setServiceType(e.target.value as ServiceType)}
                className={inputClass}
              >
                {SERVICE_TYPES.map((st) => (
                  <option key={st} value={st}>
                    {t.services[st]}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1.5 block">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                {t.projects.form.owner}
              </span>
              <select
                value={assignedEmployeeId}
                onChange={(e) => setAssignedEmployeeId(e.target.value)}
                className={inputClass}
              >
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {language === "ar" ? emp.nameAr : emp.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="space-y-1.5 block">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                {t.projects.form.startDate}
              </span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={`${inputClass} font-mono-num`}
              />
            </label>
            <label className="space-y-1.5 block">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                {t.projects.form.deadline}
              </span>
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className={`${inputClass} font-mono-num`}
              />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="space-y-1.5 block">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                {t.projects.form.workload}
              </span>
              <input
                type="number"
                min={1}
                max={300}
                value={estimatedWorkload}
                onChange={(e) => setEstimatedWorkload(Number(e.target.value))}
                className={`${inputClass} font-mono-num`}
              />
            </label>
            <label className="space-y-1.5 block">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                {t.projects.form.budget}
              </span>
              <input
                type="number"
                min={0}
                max={10000000}
                step={100}
                placeholder="15000"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                className={`${inputClass} font-mono-num`}
              />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="space-y-1.5 block">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                {t.projects.form.status}
              </span>
              <select
                value={status}
                onChange={(e) => {
                  const next = e.target.value as ProjectStatus;
                  setStatus(next);
                  if (next === "completed") setProgress(100);
                }}
                className={inputClass}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t.statuses[s]}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1.5 block">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                {t.projects.form.priority}
              </span>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as PriorityLevel)}
                className={inputClass}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {t.priorities[p]}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1.5 block">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                {t.projects.form.progress} ({progress}%)
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={progress}
                onChange={(e) => setProgress(Number(e.target.value))}
                className="w-full mt-2 accent-blue-600"
              />
            </label>
          </div>

          <label className="space-y-1.5 block">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
              {t.projects.form.notes}
            </span>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={inputClass}
            />
          </label>

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              {t.projects.form.cancel}
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer"
            >
              {initialProject ? t.projects.form.save : t.projects.form.create}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ProjectDetailModal({
  project,
  assessment,
  owner,
  language,
  onClose,
  onEdit,
}: {
  project: Project | null;
  assessment?: ProjectRiskAssessment;
  owner?: Employee;
  language: Language;
  onClose: () => void;
  onEdit: (p: Project) => void;
}) {
  const t = getCopy(language);

  useEffect(() => {
    if (!project) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [project, onClose]);

  if (!project) return null;

  const title = language === "ar" ? project.titleAr : project.title;
  const client = language === "ar" ? project.clientNameAr : project.clientName;
  const ownerName = owner ? (language === "ar" ? owner.nameAr : owner.name) : "—";
  const blocker = extractProjectBlocker(project);
  const blockerText = language === "ar" ? blocker.ar : blocker.en;
  const daysDelta = assessment?.daysUntilDeadline ?? diffDays(getTodayISO(), project.deadline);
  const scheduleSummary =
    project.status === "completed"
      ? t.statuses.completed
      : daysDelta < 0
      ? `${Math.abs(daysDelta)}${t.dashboard.alerts.daysOverdue}`
      : daysDelta === 0
      ? t.dashboard.alerts.dueToday
      : `${daysDelta}${t.dashboard.alerts.daysLeft}`;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-black/70 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-xs font-mono-num text-blue-700 dark:text-blue-400 font-semibold">
              {project.id}
            </span>
            <h2 className="text-base font-bold text-[#0F294A] dark:text-slate-100 mt-0.5">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.projects.form.close}
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 text-sm">
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <div className="text-slate-400 dark:text-slate-500">{t.projects.form.client}</div>
              <div className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">{client}</div>
            </div>
            <div>
              <div className="text-slate-400 dark:text-slate-500">{t.projects.form.service}</div>
              <div className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                {t.services[project.serviceType]}
              </div>
            </div>
            <div>
              <div className="text-slate-400 dark:text-slate-500">{t.projects.form.owner}</div>
              <div className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                {ownerName}
              </div>
            </div>
            <div>
              <div className="text-slate-400 dark:text-slate-500">{t.projects.form.workload}</div>
              <div className="font-mono-num font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                {project.estimatedWorkload} {t.projects.hoursSuffix}
                {assessment && (
                  <span className="text-slate-500 dark:text-slate-400 font-normal ms-1.5">
                    ({assessment.remainingWorkloadHours}
                    {t.projects.hoursSuffix})
                  </span>
                )}
              </div>
            </div>
            <div>
              <div className="text-slate-400 dark:text-slate-500">{t.projects.form.deadline}</div>
              <div className="font-mono-num font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                {project.deadline}
              </div>
            </div>
            <div>
              <div className="text-slate-400 dark:text-slate-500">
                {t.projects.details.scheduleStatus}
              </div>
              <div
                className={`font-mono-num font-semibold mt-0.5 ${
                  daysDelta < 0 && project.status !== "completed"
                    ? "text-red-700 dark:text-red-400"
                    : "text-slate-800 dark:text-slate-200"
                }`}
              >
                {scheduleSummary}
              </div>
            </div>
            <div>
              <div className="text-slate-400 dark:text-slate-500">
                {t.projects.details.budgetLabel}
              </div>
              <div className="font-mono-num font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                {typeof project.budget === "number"
                  ? `$${project.budget.toLocaleString("en-US")}`
                  : "—"}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
            <StatusLabel status={project.status} label={t.statuses[project.status]} />
            <PriorityLabel priority={project.priority} label={t.priorities[project.priority]} />
            <span className="font-mono-num text-xs font-semibold text-slate-800 dark:text-slate-200">
              {project.progress}%
            </span>
            {assessment && (
              <RiskLevelLabel
                level={assessment.riskLevel}
                label={`${t.riskLevels[assessment.riskLevel]} (${assessment.riskScore}/100)`}
              />
            )}
          </div>

          <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="text-xs font-semibold text-slate-600 dark:text-slate-400">
              {t.projects.details.blocker}
            </div>
            <p
              className={`text-xs leading-relaxed ${
                blocker.hasRecordedBlocker
                  ? "text-slate-800 dark:text-slate-200"
                  : "text-amber-700 dark:text-amber-300"
              }`}
            >
              {blockerText}
            </p>
          </div>

          {assessment && (
            <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="space-y-1">
                <div className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                  {t.projects.details.riskExplanation}
                </div>
                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                  {language === "ar" ? assessment.observationAr : assessment.observationEn}
                </p>
              </div>
              <div className="space-y-1">
                <div className="text-xs font-semibold text-[#0F294A] dark:text-blue-400">
                  {t.projects.details.recommendedAction}
                </div>
                <p className="text-xs text-slate-800 dark:text-slate-200 font-medium leading-relaxed">
                  {language === "ar"
                    ? assessment.recommendedActionAr
                    : assessment.recommendedActionEn}
                </p>
              </div>
            </div>
          )}

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              {t.projects.form.close}
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                onEdit(project);
              }}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer"
            >
              {t.projects.editTitle}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DeleteConfirmModal({
  project,
  language,
  onCancel,
  onConfirm,
}: {
  project: Project | null;
  language: Language;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = getCopy(language);

  useEffect(() => {
    if (!project) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [project, onCancel]);

  if (!project) return null;
  const title = language === "ar" ? project.titleAr : project.title;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-black/70 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md p-6 space-y-4 shadow-xl">
        <h2 className="text-base font-bold text-[#0F294A] dark:text-slate-100">
          {t.projects.deleteTitle}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t.projects.deleteConfirm}{" "}
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            ({project.id} — {title})
          </span>
        </p>
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            {t.projects.form.cancel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg cursor-pointer"
          >
            {t.projects.form.delete}
          </button>
        </div>
      </div>
    </div>
  );
}
