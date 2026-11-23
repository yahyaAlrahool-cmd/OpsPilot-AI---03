import React, { useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw, Send, Sparkles, Square } from "lucide-react";
import { ChatMessage, Language } from "../types";
import { getCopy } from "../i18n/translations";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { MarkdownRenderer } from "../components/MarkdownRenderer";

interface AskOpsPilotViewProps {
  language: Language;
  messages: ChatMessage[];
  loading: boolean;
  loadingStage: string | null;
  error: string | null;
  onSendMessage: (text: string) => void;
  onStopStreaming: () => void;
  onClearChat: () => void;
}

export const AskOpsPilotView = React.memo(function AskOpsPilotView({
  language,
  messages,
  loading,
  loadingStage,
  error,
  onSendMessage,
  onStopStreaming,
  onClearChat,
}: AskOpsPilotViewProps) {
  const t = getCopy(language);
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "auto" });
  }, [messages.length, loading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    setInput("");
    onSendMessage(trimmed);
  };

  const lastMessage = messages[messages.length - 1];
  const waitingFirstToken =
    loading && (!lastMessage || lastMessage.role === "user" || !lastMessage.content);

  return (
    <div className="space-y-5 flex flex-col h-[calc(100dvh-136px)] min-h-[520px]">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0F294A] dark:text-slate-100">
            {t.ask.title}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t.ask.subtitle}</p>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            disabled={loading}
            onClick={onClearChat}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{t.ask.clearChat}</span>
          </button>
        )}
      </div>

      {/* Suggested Prompt Buttons */}
      <div className="flex flex-wrap gap-2 shrink-0">
        {t.ask.suggestedPrompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            disabled={loading}
            onClick={() => onSendMessage(prompt)}
            className="px-3 py-1.5 text-xs font-medium text-[#0F294A] dark:text-slate-200 bg-white dark:bg-[#111827] hover:bg-blue-50 dark:hover:bg-blue-950/50 hover:text-blue-800 dark:hover:text-blue-300 border border-slate-200 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Chat Panel */}
      <div className="flex-1 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl flex flex-col overflow-hidden min-h-0">
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <ErrorBoundary variant="panel" language={language} onRetry={onClearChat}>
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-2 py-8">
                <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800/70 flex items-center justify-center text-blue-700 dark:text-blue-400">
                  <Sparkles className="w-5 h-5" />
                </div>
                <h2 className="text-sm font-semibold text-[#0F294A] dark:text-slate-100">
                  {t.ask.welcomeTitle}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  {t.ask.welcomeDesc}
                </p>
              </div>
            ) : (
              messages.map((m) => {
                if (m.role === "assistant" && !m.content) return null;
                return (
                  <div
                    key={m.id}
                    className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      dir={language === "ar" ? "rtl" : "ltr"}
                      className={`max-w-[88%] rounded-xl px-4 py-3 text-start ${
                        m.role === "user"
                          ? "bg-[#0F294A] dark:bg-blue-700 text-white text-sm leading-relaxed whitespace-pre-wrap"
                          : "bg-slate-50 dark:bg-[#162033] border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200"
                      }`}
                    >
                      {m.role === "user" ? (
                        m.content
                      ) : (
                        <MarkdownRenderer
                          content={m.content}
                          isUser={false}
                          dir={language === "ar" ? "rtl" : "ltr"}
                        />
                      )}
                    </div>
                  </div>
                );
              })
            )}

            {waitingFirstToken && (
              <div className="flex justify-start">
                <div className="bg-slate-50 dark:bg-[#162033] border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 animate-spin shrink-0" />
                  <span>{loadingStage || t.ask.thinking}</span>
                </div>
              </div>
            )}

            {error && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/70 text-xs text-red-700 dark:text-red-300">
                {error}
              </div>
            )}
            <div ref={endRef} />
          </ErrorBoundary>
        </div>

        <form
          onSubmit={handleSubmit}
          className="p-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-[#0B1120]/60 flex items-center gap-2.5"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
            placeholder={t.ask.placeholder}
            className="flex-1 px-3.5 py-2.5 text-sm bg-white dark:bg-[#111827] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-100 dark:disabled:bg-slate-900 disabled:cursor-not-allowed"
          />
          {loading ? (
            <button
              type="button"
              onClick={onStopStreaming}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Square className="w-3 h-3 fill-current" />
              <span>{t.ask.stop}</span>
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{t.ask.send}</span>
            </button>
          )}
        </form>
      </div>
    </div>
  );
});
