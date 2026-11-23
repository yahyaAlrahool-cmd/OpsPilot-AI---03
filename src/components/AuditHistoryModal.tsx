import React, { useCallback, useEffect, useState } from "react";
import { AlertCircle, History, Loader2, RefreshCw, X } from "lucide-react";
import { AuditLogEntry, Language } from "../types";
import { getCopy } from "../i18n/translations";
import { fetchAuditLogsApi } from "../services/workspaceService";

interface AuditHistoryModalProps {
  open: boolean;
  language: Language;
  onClose: () => void;
}

export function AuditHistoryModal({
  open,
  language,
  onClose,
}: AuditHistoryModalProps) {
  const t = getCopy(language);
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLogs = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchAuditLogsApi(60, signal);
      if (signal?.aborted) return;
      setEntries(list);
    } catch (err) {
      if (signal?.aborted) return;
      if (err instanceof Error && err.name === "AbortError") return;
      setError(t.workspace.auditLoadError);
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [t.workspace.auditLoadError]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void loadLogs(controller.signal);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      controller.abort();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, loadLogs, onClose]);

  if (!open) return null;

  const formatTimestamp = (iso: string) => {
    const parsed = Date.parse(iso);
    if (Number.isNaN(parsed)) return iso;
    return new Intl.DateTimeFormat(language === "ar" ? "ar-EG" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(parsed));
  };

  const actionTone = (action: AuditLogEntry["action"]) => {
    switch (action) {
      case "project_created":
        return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/70";
      case "project_deleted":
      case "workspace_reset":
        return "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800/70";
      case "project_reassigned":
        return "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/70";
      case "legacy_migrated":
      case "workspace_seeded":
        return "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/70";
      default:
        return "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700";
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-black/70 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="audit-history-title"
    >
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#0F294A] dark:bg-blue-600 text-white flex items-center justify-center shrink-0">
              <History className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2
                id="audit-history-title"
                className="text-sm font-bold text-[#0F294A] dark:text-slate-100 truncate"
              >
                {t.workspace.auditHistoryTitle}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {t.workspace.auditHistorySubtitle}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => void loadLogs()}
              disabled={loading}
              aria-label={t.workspace.retry}
              className="p-1.5 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={t.workspace.auditClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading && entries.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-xs text-slate-500 dark:text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
              <span>{t.workspace.auditLoading}</span>
            </div>
          ) : error ? (
            <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/70 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
              <button
                type="button"
                onClick={() => void loadLogs()}
                className="px-3 py-1.5 text-xs font-semibold bg-white dark:bg-slate-900 border border-red-200 dark:border-red-800 rounded-md hover:bg-red-50 dark:hover:bg-red-950/60 cursor-pointer"
              >
                {t.workspace.retry}
              </button>
            </div>
          ) : entries.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
              {t.workspace.auditEmpty}
            </div>
          ) : (
            <div className="space-y-3">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-[#0B1120]/70 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border ${actionTone(
                          entry.action
                        )}`}
                      >
                        {t.workspace.auditActions[entry.action] ?? entry.action}
                      </span>
                      <span className="text-xs font-mono-num font-semibold text-[#0F294A] dark:text-blue-400">
                        {entry.entityId}
                      </span>
                      <span className="text-[11px] font-mono-num text-slate-500 dark:text-slate-400">
                        {t.workspace.auditVersion}: v{entry.previousVersion} → v{entry.newVersion}
                      </span>
                    </div>
                    <span className="text-[11px] font-mono-num text-slate-400 dark:text-slate-500">
                      {formatTimestamp(entry.createdAt)}
                    </span>
                  </div>

                  {entry.summary && (
                    <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                      {entry.summary}
                    </p>
                  )}

                  {entry.changedFields.length > 0 && (
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="font-medium">{t.workspace.auditFields}: </span>
                      <span className="font-mono-num">{entry.changedFields.join(", ")}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            {t.workspace.auditClose}
          </button>
        </div>
      </div>
    </div>
  );
}
