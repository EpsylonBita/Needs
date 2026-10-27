'use client';

import { useState } from 'react';
import Image from 'next/image';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ImageOff, Images } from 'lucide-react';
import { useI18n } from '@/contexts/i18n-context';

interface ListingGalleryProps {
  title: string;
  images: { url: string }[];
}

export function ListingGallery({ title, images }: ListingGalleryProps) {
  const { locale } = useI18n();
  const el = locale === 'el';
  const reduceMotion = useReducedMotion();
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [failedUrls, setFailedUrls] = useState<Set<string>>(() => new Set());
  const index = Math.max(0, images.findIndex(image => image.url === selectedUrl));
  const selected = images[index];
  const photoLabel = (number: number) => el ? `Προβολή φωτογραφίας ${number}` : `View photo ${number}`;
  const markFailed = (url: string) => setFailedUrls(previous => new Set(previous).add(url));

  if (!selected) return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-muted/40 p-8 text-muted-foreground">
      <Images className="h-8 w-8 stroke-[1.25]" aria-hidden="true" />
      <p className="text-sm">{el ? 'Δεν έχουν προστεθεί φωτογραφίες' : 'No photos added'}</p>
    </div>
  );

  return (
    <section aria-label={el ? 'Φωτογραφίες αγγελίας' : 'Listing photos'} className="space-y-3">
      <div className="relative aspect-[4/3] max-h-[520px] w-full overflow-hidden rounded-2xl border border-border bg-muted/40">
        <AnimatePresence initial={false}>
          <motion.div key={selected.url} className="absolute inset-0" initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: reduceMotion ? 1 : 0 }} transition={{ duration: reduceMotion ? 0 : 0.18 }}>
            {failedUrls.has(selected.url) ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
                <ImageOff className="h-8 w-8 stroke-[1.25]" aria-hidden="true" />
                <p className="text-sm">{el ? 'Η φωτογραφία δεν είναι διαθέσιμη' : 'This photo is unavailable'}</p>
              </div>
            ) : (
              <Image src={selected.url} alt={`${title} · ${index + 1}`} fill unoptimized sizes="(min-width: 1024px) 700px, 100vw" className="object-contain" onError={() => markFailed(selected.url)} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
      {images.length > 1 && <div className="flex min-w-0 max-w-full gap-2 overflow-x-auto p-1">
        {images.map((image, imageIndex) => <button key={`${image.url}-${imageIndex}`} type="button" aria-label={photoLabel(imageIndex + 1)} aria-pressed={imageIndex === index}
          onClick={() => setSelectedUrl(image.url)}
          className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-border bg-muted/40 opacity-65 transition-opacity hover:opacity-100 aria-pressed:border-primary aria-pressed:opacity-100 aria-pressed:ring-2 aria-pressed:ring-primary aria-pressed:ring-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background sm:h-18 sm:w-18">
          {failedUrls.has(image.url) ? <ImageOff className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden="true" />
            : <Image src={image.url} alt="" fill unoptimized sizes="72px" className="object-cover" onError={() => markFailed(image.url)} />}
        </button>)}
      </div>}
      <p className="text-xs text-muted-foreground" aria-live="polite" aria-atomic="true">
        {el ? `Φωτογραφία ${index + 1} από ${images.length}` : `Photo ${index + 1} of ${images.length}`}
      </p>
      </div>
    </section>
  );
}
