"use client";
import { useI18n } from "@/contexts/i18n-context";

export default function AboutClient() {
  const { t } = useI18n();
  return (
    <div className="container mx-auto p-4 pt-[72px]">
      <h1 className="text-2xl font-bold">{t('about.title','About')}</h1>
      <p>{t('about.body','This is the About page.')}</p>
    </div>
  );
}