'use client';

import { useState, useEffect } from 'react';
import { getCurrentLocation } from '@/lib/services/location-service';

interface Location {
  lat: number;
  lng: number;
}

interface GeolocationResult {
  location: Location | null;
  error: string | null;
  isLoading: boolean;
}

/**
 * Hook to get and track the user's geolocation
 */
export function useGeolocation(): GeolocationResult {
  const [location, setLocation] = useState<Location | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;

    const fetchLocation = async () => {
      try {
        const position = await getCurrentLocation();
        if (isMounted) {
          setLocation(position);
          setError(null);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Unknown error occurred');
          setLocation(null);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    fetchLocation();

    return () => {
      isMounted = false;
    };
  }, []);

  return { location, error, isLoading };
} 