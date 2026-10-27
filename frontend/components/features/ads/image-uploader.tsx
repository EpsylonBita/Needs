"use client";

import { useId, useRef } from "react";
import Image from "next/image";
import { Camera, ImagePlus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/contexts/i18n-context";

interface ImageUploaderProps {
  imagePreviews: string[];
  onRemove: (index: number) => void;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
}

const ACCEPTED_IMAGES = "image/jpeg,image/png,image/webp,image/gif";
const PHOTO_LIMIT = 6;

export function ImageUploader({ imagePreviews, onRemove, onChange, disabled = false }: ImageUploaderProps) {
  const { locale } = useI18n();
  const isGreek = locale === 'el';
  const id = useId();
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const atLimit = imagePreviews.length >= PHOTO_LIMIT;
  const cannotAdd = disabled || atLimit;

  return (
    <div className="space-y-3">
      {imagePreviews.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 min-[360px]:grid-cols-3">
          {imagePreviews.map((preview, index) => (
            <div key={`${preview}-${index}`} className="relative aspect-square overflow-hidden rounded-2xl border border-border bg-muted motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
              <Image
                src={preview}
                alt={isGreek ? `Φωτογραφία αγγελίας ${index + 1}` : `Listing photo ${index + 1}`}
                fill
                unoptimized
                sizes="(max-width: 359px) 42vw, (max-width: 639px) 28vw, 180px"
                className="object-cover"
              />
              {index === 0 && (
                <span className="absolute bottom-2 left-2 rounded-full bg-black/75 px-2.5 py-1 text-xs font-medium text-white">
                  {isGreek ? 'Εξώφυλλο' : 'Cover photo'}
                </span>
              )}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onRemove(index)}
                className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 disabled:opacity-50 motion-safe:transition-colors"
                aria-label={isGreek ? `Αφαίρεση φωτογραφίας ${index + 1}` : `Remove photo ${index + 1}`}
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-2xl border border-border bg-muted/25 p-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Camera className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{isGreek ? 'Δείξε τι θέλεις να ανεβάσεις' : 'Show what you want to list'}</p>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{isGreek ? 'Μια φωτογραφία βοηθά. Μπορείς να συνεχίσεις και χωρίς αυτή.' : 'A photo helps. You can also continue without one.'}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2">
        <Button type="button" variant="outline" disabled={cannotAdd} onClick={() => cameraInput.current?.click()} aria-describedby={`${id}-photo-help`} className="min-h-11 w-full rounded-xl">
          <Camera className="h-4 w-4" aria-hidden="true" />
          {isGreek ? 'Βγάλε φωτογραφία' : 'Take a photo'}
        </Button>
        <Button type="button" disabled={cannotAdd} onClick={() => galleryInput.current?.click()} aria-describedby={`${id}-photo-help`} className="min-h-11 w-full rounded-xl">
          <ImagePlus className="h-4 w-4" aria-hidden="true" />
          {isGreek ? 'Επίλεξε φωτογραφίες' : 'Choose photos'}
        </Button>
      </div>

      <input ref={cameraInput} id={`${id}-camera`} type="file" hidden accept={ACCEPTED_IMAGES} capture="environment" disabled={cannotAdd} onChange={onChange} aria-label={isGreek ? 'Φωτογραφία από κάμερα' : 'Camera photo'} />
      <input ref={galleryInput} id={`${id}-gallery`} type="file" hidden accept={ACCEPTED_IMAGES} multiple disabled={cannotAdd} onChange={onChange} aria-label={isGreek ? 'Φωτογραφίες από συσκευή' : 'Photos from device'} />

      <div id={`${id}-photo-help`} className="space-y-1 text-xs leading-5 text-muted-foreground">
        <p>{isGreek ? 'Έως 6 φωτογραφίες · JPG, PNG, WebP ή GIF · έως 5 MB η καθεμία' : 'Up to 6 photos · JPG, PNG, WebP or GIF · up to 5 MB each'}</p>
        <p>{isGreek ? 'Στο κινητό, η λήψη ανοίγει την κάμερα όπου υποστηρίζεται.' : 'On mobile, photo capture opens the camera where supported.'}</p>
      </div>
      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {atLimit
          ? isGreek ? 'Έφτασες τις 6 φωτογραφίες. Αφαίρεσε μία για να προσθέσεις άλλη.' : 'You have 6 photos. Remove one to add another.'
          : imagePreviews.length > 0 ? isGreek ? `${imagePreviews.length} από 6 φωτογραφίες` : `${imagePreviews.length} of 6 photos` : ''}
      </p>
    </div>
  );
}
