"use client";
import { useI18n } from "@/contexts/i18n-context";

export default function PrivacyClient() {
  const { t, formatDate } = useI18n();
  return (
    <div className="container max-w-4xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight mb-6 text-blue-600 dark:text-blue-400">{t('privacy.title','Privacy Policy')}</h1>
      <div className="prose prose-blue dark:prose-invert max-w-none">
        <p className="text-muted-foreground">
          {t('privacy.lastUpdated','Last updated')}: {formatDate(new Date(), { month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
      </div>
    </div>
  );
}