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
    <div className="space-y-4">
      {imagePreviews.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {imagePreviews.map((preview, index) => (
            <div key={`${preview}-${index}`} className="relative aspect-square overflow-hidden rounded-2xl border border-border bg-muted motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
              <Image
                src={preview}
                alt={isGreek ? `Φωτογραφία αγγελίας ${index + 1}` : `Listing photo ${index + 1}`}
                fill
                unoptimized
                sizes="(max-width: 640px) 45vw, 180px"
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
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-primary/30 bg-primary/5 px-4 py-8 text-center">
          <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-background text-primary shadow-sm">
            <Camera className="h-7 w-7" aria-hidden="true" />
          </span>
          <p className="font-semibold text-foreground">{isGreek ? 'Δείξε τι θέλεις να ανεβάσεις' : 'Show what you want to list'}</p>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">{isGreek ? 'Μια φωτογραφία βοηθά. Μπορείς να συνεχίσεις και χωρίς αυτή.' : 'A photo helps. You can also continue without one.'}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2">
        <Button type="button" disabled={cannotAdd} onClick={() => cameraInput.current?.click()} aria-describedby={`${id}-photo-help`} className="w-full motion-safe:transition-transform motion-safe:active:scale-[0.98] motion-reduce:transition-none">
          <Camera className="h-4 w-4" aria-hidden="true" />
          {isGreek ? 'Βγάλε φωτογραφία' : 'Take a photo'}
        </Button>
        <Button type="button" variant="outline" disabled={cannotAdd} onClick={() => galleryInput.current?.click()} aria-describedby={`${id}-photo-help`} className="w-full motion-safe:transition-transform motion-safe:active:scale-[0.98] motion-reduce:transition-none">
          <ImagePlus className="h-4 w-4" aria-hidden="true" />
          {isGreek ? 'Επίλεξε φωτογραφίες' : 'Choose photos'}
        </Button>
      </div>

      <input ref={cameraInput} id={`${id}-camera`} type="file" hidden accept={ACCEPTED_IMAGES} capture="environment" disabled={cannotAdd} onChange={onChange} aria-label={isGreek ? 'Φωτογραφία από κάμερα' : 'Camera photo'} />
      <input ref={galleryInput} id={`${id}-gallery`} type="file" hidden accept={ACCEPTED_IMAGES} multiple disabled={cannotAdd} onChange={onChange} aria-label={isGreek ? 'Φωτογραφίες από συσκευή' : 'Photos from device'} />

      <div id={`${id}-photo-help`} className="space-y-1 text-center text-xs text-muted-foreground">
        <p>{isGreek ? 'Έως 6 φωτογραφίες · JPG, PNG, WebP ή GIF · έως 5 MB η καθεμία' : 'Up to 6 photos · JPG, PNG, WebP or GIF · up to 5 MB each'}</p>
        <p>{isGreek ? 'Στο κινητό, η λήψη ανοίγει την κάμερα όπου υποστηρίζεται.' : 'On mobile, photo capture opens the camera where supported.'}</p>
      </div>
      <p role="status" className="text-center text-sm text-muted-foreground">
        {atLimit
          ? isGreek ? 'Έφτασες τις 6 φωτογραφίες. Αφαίρεσε μία για να προσθέσεις άλλη.' : 'You have 6 photos. Remove one to add another.'
          : imagePreviews.length > 0 ? isGreek ? `${imagePreviews.length} από 6 φωτογραφίες` : `${imagePreviews.length} of 6 photos` : ''}
      </p>
    </div>
  );
}
