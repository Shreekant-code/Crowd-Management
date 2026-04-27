"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from "lucide-react";

const ToastContext = createContext(null);

const toastStyles = {
  success: {
    icon: CheckCircle2,
    accent: "border-emerald-200 bg-emerald-50 text-emerald-800",
    iconColor: "text-emerald-600",
  },
  error: {
    icon: AlertCircle,
    accent: "border-red-200 bg-red-50 text-red-800",
    iconColor: "text-red-600",
  },
  warning: {
    icon: TriangleAlert,
    accent: "border-amber-200 bg-amber-50 text-amber-800",
    iconColor: "text-amber-600",
  },
  info: {
    icon: Info,
    accent: "border-slate-200 bg-white text-slate-800",
    iconColor: "text-slate-600",
  },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismissToast = useCallback((id) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }

    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback(
    ({ title, description = "", tone = "info", duration = 4500 }) => {
      const id = crypto.randomUUID();

      setToasts((current) => [...current, { id, title, description, tone }]);

      const timer = setTimeout(() => {
        dismissToast(id);
      }, duration);

      timers.current.set(id, timer);
      return id;
    },
    [dismissToast]
  );

  const value = useMemo(
    () => ({
      pushToast,
      dismissToast,
    }),
    [dismissToast, pushToast]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-full max-w-sm flex-col gap-3">
        {toasts.map((toast) => {
          const style = toastStyles[toast.tone] || toastStyles.info;
          const Icon = style.icon;

          return (
            <div
              key={toast.id}
              className={`pointer-events-auto rounded-2xl border px-4 py-4 shadow-panel backdrop-blur transition ${style.accent}`}
              role="status"
            >
              <div className="flex items-start gap-3">
                <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${style.iconColor}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{toast.title}</p>
                  {toast.description ? (
                    <p className="mt-1 text-sm leading-5 opacity-90">{toast.description}</p>
                  ) : null}
                </div>
                <button
                  className="rounded-full p-1 opacity-60 transition hover:bg-black/5 hover:opacity-100"
                  onClick={() => dismissToast(toast.id)}
                  type="button"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error("useToast must be used inside ToastProvider");
  }

  return context;
}

