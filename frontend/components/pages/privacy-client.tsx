"use client";
import { useI18n } from "@/contexts/i18n-context";

export default function PrivacyClient() {
  const { t, locale } = useI18n();
  return (
    <div className="container max-w-4xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight mb-6 text-blue-600 dark:text-blue-400">{t('privacy.title','Privacy Policy')}</h1>
      <div className="prose prose-blue dark:prose-invert max-w-none">
        <p className="text-muted-foreground">
          {locale === 'el'
            ? 'Η τελική πολιτική απορρήτου δεν έχει δημοσιευτεί ακόμη. Το κείμενο θα προστεθεί όταν οριστικοποιηθούν τα στοιχεία του υπεύθυνου επεξεργασίας και οι πρακτικές διαχείρισης δεδομένων.'
            : 'The final privacy policy has not been published yet. It will be added once the data controller details and data handling practices have been finalized.'}
        </p>
      </div>
    </div>
  );
}
