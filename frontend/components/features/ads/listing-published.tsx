"use client";

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DialogDescription, DialogTitle } from '@/components/ui/dialog';

export function ListingPublished({ listing, isGreek, onDone }: {
  listing: { id: string; title: string };
  isGreek: boolean;
  onDone: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const confirmation = useRef<HTMLDivElement>(null);

  useEffect(() => { confirmation.current?.focus(); }, []);

  return <div className="flex min-h-0 flex-col items-center overflow-y-auto px-1 py-3 text-center sm:py-5">
    <motion.div aria-hidden="true" className="mb-5 flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-8 ring-primary/5"
      initial={reduceMotion ? false : { opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 360, damping: 22 }}>
      <Check className="h-7 w-7" strokeWidth={2.5} />
    </motion.div>
    <div ref={confirmation} tabIndex={-1} role="status" className="rounded-xl focus:outline-none">
      <DialogTitle className="text-xl font-semibold tracking-tight sm:text-2xl">{isGreek ? 'Η αγγελία σου δημοσιεύτηκε!' : 'Your listing is published!'}</DialogTitle>
      <DialogDescription className="mx-auto mt-2 max-w-sm text-sm leading-relaxed">{isGreek ? 'Όλα έτοιμα. Η αγγελία σου είναι πλέον διαθέσιμη στην κοινότητα.' : 'All set. Your listing is now available to the community.'}</DialogDescription>
    </div>
    <p className="mt-4 w-full break-words border-y border-border py-3 text-sm font-medium">{listing.title}</p>
    <div className="mt-4 flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
      <Button asChild className="min-h-11 rounded-xl sm:flex-1"><Link href={`/listings/${encodeURIComponent(listing.id)}`} onNavigate={onDone}>{isGreek ? 'Προβολή αγγελίας' : 'View listing'}<ArrowUpRight className="h-4 w-4" aria-hidden="true" /></Link></Button>
      <Button type="button" variant="ghost" onClick={onDone} className="min-h-11 rounded-xl sm:flex-1">{isGreek ? 'Τέλος' : 'Done'}</Button>
    </div>
  </div>;
}
