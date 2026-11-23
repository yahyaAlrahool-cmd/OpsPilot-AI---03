import React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Language } from "../types";
import { getCopy } from "../i18n/translations";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  language?: Language;
  variant?: "app" | "panel";
  fallbackTitle?: string;
  fallbackDescription?: string;
  fallbackRetryLabel?: string;
  onRetry?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    if (import.meta.env.DEV) {
      console.error("[OpsPilot ErrorBoundary]", {
        name: error?.name,
        message: error?.message,
        componentStack: info?.componentStack,
      });
    }
  }

  handleReset = () => {
    this.setState({ hasError: false });
    this.props.onRetry?.();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const lang: Language =
      this.props.language ??
      (typeof document !== "undefined" && document.documentElement.lang === "ar" ? "ar" : "en");
    const t = getCopy(lang);

    if (this.props.variant === "app") {
      return (
        <div
          dir={lang === "ar" ? "rtl" : "ltr"}
          className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B1120] flex items-center justify-center p-6"
        >
          <div className="max-w-md w-full bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4 text-center">
            <div className="w-10 h-10 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/60 text-red-700 dark:text-red-300 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <h1 className="text-base font-bold text-[#0F294A] dark:text-slate-100">
              {this.props.fallbackTitle ?? t.brand}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {this.props.fallbackDescription ?? t.aiStates.errorMessage}
            </p>
            <button
              type="button"
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{this.props.fallbackRetryLabel ?? t.aiStates.retry}</span>
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-xs text-red-700 dark:text-red-300">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            {this.props.fallbackTitle && (
              <div className="font-bold text-sm text-red-800 dark:text-red-200">
                {this.props.fallbackTitle}
              </div>
            )}
            <span>{this.props.fallbackDescription ?? t.aiStates.errorMessage}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={this.handleReset}
          className="px-3 py-1.5 bg-white dark:bg-slate-900 border border-red-200 dark:border-red-800 rounded font-medium text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/60 whitespace-nowrap shrink-0 cursor-pointer"
        >
          {this.props.fallbackRetryLabel ?? t.aiStates.retry}
        </button>
      </div>
    );
  }
}
