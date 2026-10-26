"use client";
import { useI18n } from "@/contexts/i18n-context";

export default function TermsClient() {
  const { t, locale } = useI18n();
  return (
    <div className="container max-w-4xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight mb-6 text-blue-600 dark:text-blue-400">{t('terms.title','Terms of Service')}</h1>
      <div className="prose prose-blue dark:prose-invert max-w-none">
        <p className="text-muted-foreground">
          {locale === 'el'
            ? 'Οι τελικοί όροι χρήσης δεν έχουν δημοσιευτεί ακόμη. Το κείμενο θα προστεθεί όταν οριστικοποιηθούν τα στοιχεία του φορέα λειτουργίας και οι όροι των συναλλαγών.'
            : 'The final terms of service have not been published yet. They will be added once the operator details and transaction terms have been finalized.'}
        </p>
      </div>
    </div>
  );
}
