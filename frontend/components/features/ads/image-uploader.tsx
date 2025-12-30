"use client";

import Image from "next/image";

import { ImagePlus } from "lucide-react";

import { useI18n } from "@/contexts/i18n-context";
import { cn } from "@/lib/utils";

interface ImageUploaderProps {
  imagePreviews: string[];
  onRemove: (index: number) => void;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function ImageUploader({ imagePreviews, onRemove, onChange }: ImageUploaderProps) {
  const { t } = useI18n();
  return (
    <div className="mt-2 space-y-4">
      {imagePreviews.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
          {imagePreviews.map((preview, index) => (
            <div key={index} className="relative group aspect-square">
              <Image src={preview} alt={`Preview ${index + 1}`} fill className="object-cover rounded-lg" />
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg">
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  className="text-white bg-red-500 hover:bg-red-600 p-2 rounded-full"
                  aria-label={t('ad.images.remove','Remove image')}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <label
        htmlFor="image"
        className={cn(
          "relative block w-full rounded-lg cursor-pointer",
          "ring-1 ring-blue-200/50 dark:ring-blue-900/30",
          "hover:ring-2 hover:ring-blue-500 hover:shadow-[0_0_0_4px_rgba(59,130,246,0.1)] dark:hover:shadow-[0_0_0_4px_rgba(59,130,246,0.1)]",
          "transition-all duration-200"
        )}
      >
        <div className="h-32 overflow-hidden rounded-lg">
          <div className="h-full flex flex-col items-center justify-center bg-white dark:bg-gray-950">
            <ImagePlus className="w-8 h-8 text-blue-500 mb-2" />
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('ad.images.drop','Drop more images here, or')} <span className="text-blue-500">{t('ad.images.browse','browse')}</span>
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {t('ad.images.formats','PNG, JPG or WEBP (max. 2MB each)')}
            </p>
          </div>
        </div>
        <input
          id="image"
          type="file"
          multiple
          className="hidden"
          accept="image/png,image/jpeg,image/webp"
          onChange={onChange}
        />
      </label>
    </div>
  )
}
