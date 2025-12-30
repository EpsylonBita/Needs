"use client";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import Cookies from "js-cookie";

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

function loadMessages(locale: string): Messages {
  try {
    if (locale === "el") {
      const el = require("@/locales/el").messages as Messages;
      return el;
    }
    const en = require("@/locales/en").messages as Messages;
    return en;
  } catch {
    return {};
  }
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("locale") || Cookies.get("locale") || "en";
    }
    return "en";
  });

  const [messages, setMessages] = useState<Messages>(() => loadMessages(locale));

  useEffect(() => {
    setMessages(loadMessages(locale));
    if (typeof window !== "undefined") {
      localStorage.setItem("locale", locale);
    }
    Cookies.set("locale", locale, { sameSite: "lax" });
    try {
      const html = document.querySelector("html");
      if (html) html.setAttribute("lang", locale);
    } catch {}
  }, [locale]);

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