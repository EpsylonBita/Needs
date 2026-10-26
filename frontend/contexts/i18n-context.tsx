"use client";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import Cookies from "js-cookie";

import { messages as greekMessages } from "../locales/el";
import { messages as englishMessages } from "../locales/en";

type Messages = Record<string, string>;

type I18nContextValue = {
  locale: string;
  setLocale: (locale: string) => void;
  t: (key: string, fallback?: string) => string;
  formatCurrency: (value: number, currency?: string) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatDate: (value: Date | number | string, options?: Intl.DateTimeFormatOptions) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function supportedLocale(value: unknown): "el" | "en" | null {
  return value === "el" || value === "en" ? value : null;
}

export function I18nProvider({ children, initialLocale = "en" }: { children: React.ReactNode; initialLocale?: string }) {
  // The server and first browser render must use the same locale snapshot.
  const [locale, setLocaleState] = useState(() => supportedLocale(initialLocale) || "en");
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const messages: Messages = locale === "el" ? greekMessages : englishMessages;

  useEffect(() => {
    // Preserve localStorage-only preferences from older visits after hydration.
    let preferred: "el" | "en" | null = null;
    try { preferred = supportedLocale(localStorage.getItem("locale")); } catch { /* Storage may be disabled. */ }
    if (!preferred) {
      try { preferred = supportedLocale(Cookies.get("locale")); } catch { /* Keep the server locale when cookies are unavailable. */ }
    }
    setLocaleState(current => preferred || current);
    setPreferencesLoaded(true);
  }, []);

  useEffect(() => {
    if (!preferencesLoaded) return;
    try { localStorage.setItem("locale", locale); } catch { /* The in-memory preference still works. */ }
    try { Cookies.set("locale", locale, { sameSite: "lax" }); } catch { /* Cookies may be disabled. */ }
    document.documentElement.lang = locale;
  }, [locale, preferencesLoaded]);

  const setLocale = (l: string) => {
    setLocaleState(l === "el" ? "el" : "en");
  };

  const t = useMemo(
    () => (key: string, fallback?: string) => {
      const v = messages[key];
      if (typeof v === "string" && v.length > 0) return v;
      return typeof fallback === "string" ? fallback : key;
    },
    [messages]
  );

  const formatCurrency = (value: number, currency?: string) => {
    const cur = currency || (locale === "el" ? "EUR" : "USD");
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency: cur }).format(value);
    } catch {
      return `${value}`;
    }
  };

  const formatNumber = (value: number, options?: Intl.NumberFormatOptions) => {
    try {
      return new Intl.NumberFormat(locale, options).format(value);
    } catch {
      return `${value}`;
    }
  };

  const formatDate = (value: Date | number | string, options?: Intl.DateTimeFormatOptions) => {
    const d = typeof value === "string" || typeof value === "number" ? new Date(value) : value;
    try {
      return new Intl.DateTimeFormat(locale, options || { dateStyle: "long" }).format(d);
    } catch {
      return `${d}`;
    }
  };

  const value = useMemo<I18nContextValue>(() => ({ locale, setLocale, t, formatCurrency, formatNumber, formatDate }), [locale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return ctx;
}
