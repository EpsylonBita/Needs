"use client";
import Link from "next/link";
import { useI18n } from "@/contexts/i18n-context";

export default function AboutClient() {
  const { t, locale } = useI18n();
  const copy = locale === 'el' ? {
    intro: 'Το NEEDS συνδέει όσα χρειάζεσαι με όσα προσφέρουν οι άνθρωποι κοντά σου.',
    items: 'Αντικείμενα: ζήτησε κάτι που θέλεις να αγοράσεις, πούλησε κάτι που έχεις ή χάρισέ το δωρεάν.',
    services: 'Υπηρεσίες: δημοσίευσε αυτό που χρειάζεσαι ή τη δουλειά που μπορείς να αναλάβεις.',
    discovery: 'Αναζήτησε αγγελίες στην περιοχή σου, δες τον χάρτη και μίλησε με τον δημιουργό της αγγελίας για να συμφωνήσετε τις λεπτομέρειες.',
    payments: 'Στις πληρωμές μέσα από την πλατφόρμα, πληρώνει αυτός που ζητά το αντικείμενο ή την υπηρεσία. Η ολοκλήρωση απαιτεί επιβεβαίωση και από τις δύο πλευρές. Οι δωρεάν αγγελίες συνεννοούνται μέσω συνομιλίας.',
    trust: 'Μετά από ολοκληρωμένη πληρωμή, ο πληρωτής μπορεί να αξιολογήσει τον πωλητή ή τον πάροχο. Οι αγγελίες υπό αναστολή από διαχειριστή παραμένουν εκτός δημόσιας αναζήτησης.',
    browse: 'Βρες αυτό που χρειάζεσαι',
  } : {
    intro: 'NEEDS connects what you need with what people nearby can offer.',
    items: 'Items: ask for something you want to buy, sell something you own, or give it away for free.',
    services: 'Services: post what you need or the work you can take on.',
    discovery: 'Explore local listings and the map, then chat with the publisher to agree on the details.',
    payments: 'For payments through the platform, the person requesting the item or service pays its provider. Completion requires confirmation from both parties. Free listings are arranged through chat.',
    trust: 'After a completed payment, the payer can review the seller or provider. Listings suspended by an administrator stay out of public search.',
    browse: 'Find what you need',
  };
  return (
    <div className="container max-w-3xl mx-auto px-4 py-12 space-y-6">
      <h1 className="text-3xl font-bold">{t('about.title','About')} NEEDS</h1>
      <p className="text-xl">{copy.intro}</p>
      <ul className="list-disc pl-6 space-y-3"><li>{copy.items}</li><li>{copy.services}</li></ul>
      <p>{copy.discovery}</p>
      <p>{copy.payments}</p>
      <p>{copy.trust}</p>
      <Link href="/search" className="inline-block text-primary underline underline-offset-4">{copy.browse}</Link>
    </div>
  );
}
