"use client";

import { MapPin, Crosshair, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/contexts/i18n-context";

interface LocationPickerProps {
  locationName: string;
  showMap: boolean;
  coordinates: [number, number] | null;
  isLocating: boolean;
  errorMessage?: string | null;
  onLocationNameChange: (name: string) => void;
  onToggleMap: () => void;
  onUseCurrentLocation: () => void;
}

export function LocationPicker({ locationName, showMap, coordinates, isLocating, errorMessage, onLocationNameChange, onToggleMap, onUseCurrentLocation }: LocationPickerProps) {
  const { t } = useI18n();
  return (
    <div>
      <Label htmlFor="address" className="text-base font-semibold text-blue-600 dark:text-blue-400">
        {t('ad.location.title','Location')}
      </Label>
      <div className="mt-2 space-y-2">
        <div className="relative">
          <Input
            id="location"
            value={locationName}
            onChange={(e) => onLocationNameChange(e.target.value)}
            placeholder={t('ad.location.placeholder','Where is this located?')}
            className="pr-20 bg-white dark:bg-gray-950 border-0 ring-1 ring-blue-200/50 dark:ring-blue-900/30 focus:ring-2 focus:ring-blue-500 focus:border-0 placeholder-gray-400 focus:shadow-[0_0_0_4px_rgba(59,130,246,0.1)] dark:focus:shadow-[0_0_0_4px_rgba(59,130,246,0.1)] transition-shadow duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          />
          <div className="absolute right-1 top-1 flex items-center gap-1">
            <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 text-blue-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20" onClick={onToggleMap}>
              <MapPin className="h-4 w-4" />
              <span className="sr-only">{t('ad.location.toggleMap','Toggle map')}</span>
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 text-blue-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20" onClick={onUseCurrentLocation} disabled={isLocating}>
              {isLocating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />}
              <span className="sr-only">{t('ad.location.useCurrent','Use current location')}</span>
            </Button>
          </div>
        </div>

        {showMap && (
          <div className="relative mt-2 rounded-lg overflow-hidden h-[200px] ring-1 ring-blue-200/50 dark:ring-blue-900/30">
            <div id="location-map" className="w-full h-full" />
            {coordinates && (
              <div className="absolute bottom-2 left-2 right-2 bg-white/90 dark:bg-gray-950/90 p-2 text-xs rounded-md backdrop-blur-sm">
                <p className="font-medium text-gray-700 dark:text-gray-300">
                  {t('ad.location.selected','Selected location:')} {locationName}
                </p>
                <p className="text-gray-500">
                  {t('ad.location.coordinates','Coordinates:')} {coordinates[1].toFixed(6)}, {coordinates[0].toFixed(6)}
                </p>
              </div>
            )}
          </div>
        )}

        {errorMessage && (
          <p className="mt-2 text-sm text-red-500">{errorMessage}</p>
        )}
      </div>
    </div>
  )
}
