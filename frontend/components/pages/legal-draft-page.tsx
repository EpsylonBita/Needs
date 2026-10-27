"use client"

import Link from 'next/link'
import { useI18n } from '@/contexts/i18n-context'
import operator from '@/config/legal-operator.json'
import { legalDraftContent } from './legal-draft-content'

export default function LegalDraftPage({ kind }: { kind: 'terms' | 'privacy' }) {
  const { locale } = useI18n()
  const copy = legalDraftContent[locale === 'el' ? 'el' : 'en']
  const values = [operator.operatorName, operator.businessAddress, operator.supportEmail, operator.privacyEmail]
  return <article className="container mx-auto max-w-4xl px-4 py-10 sm:py-14">
    <header className="space-y-4">
      <p className="text-sm font-bold tracking-wide text-amber-800 dark:text-amber-300">{copy.badge}</p>
      <h1 className="text-3xl font-bold tracking-tight">{kind === 'terms' ? copy.termsTitle : copy.privacyTitle}</h1>
      <p role="note" className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm leading-relaxed text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">{copy.notice}</p>
    </header>
    <section aria-labelledby={`${kind}-operator`} className="my-8 rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h2 id={`${kind}-operator`} className="text-lg font-semibold">{copy.operatorHeading}</h2>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2">{copy.labels.map((label, index) => <div key={label} className="min-w-0">
        <dt className="text-sm text-muted-foreground">{label}</dt>
        <dd className="mt-1 break-words font-medium">{values[index]}</dd>
      </div>)}</dl>
      <Link href="/contact" className="mt-5 inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4">{copy.contact}</Link>
      <p className="text-xs leading-relaxed text-muted-foreground">{copy.contactNote}</p>
    </section>
    <div className="space-y-8">{copy[kind].map(section => <section key={section.id} aria-labelledby={`${kind}-${section.id}`} className="space-y-3">
      <h2 id={`${kind}-${section.id}`} className="text-xl font-semibold">{section.title}</h2>
      {section.paragraphs.map(paragraph => <p key={paragraph} className="leading-7 text-muted-foreground">{paragraph}</p>)}
    </section>)}</div>
  </article>
}
