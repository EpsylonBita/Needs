'use client';

import { useEffect, useRef, useState } from 'react';

import { useRouter } from 'next/navigation';

import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/auth-context';

// Initialize Mapbox token
const initializeMapbox = () => {
  const token = (process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '').trim();
  if (!token) {
    throw new Error('Mapbox token is missing. Please add NEXT_PUBLIC_MAPBOX_TOKEN to your .env.local file');
  }
  
  // Set the access token
  mapboxgl.accessToken = token;
  
  return token;
};

interface Location {
  coordinates: [number, number];
  address: string;
}

interface SearchResult {
  id: string;
  title: string;
  description: string;
  price?: number;
  location: Location;
  sellerId?: string;
  sellerRating?: number;
}

interface MapProps {
  results: SearchResult[];
  live?: boolean;
}

export function Map({ results, live }: MapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<mapboxgl.Marker[]>([]);
  const [userLocation, setUserLocation] = useState<[number, number]>([0, 0]);
  const [mapError, setMapError] = useState<string | null>(null);
  const initialized = useRef(false);
  const { user } = useAuth();
  const router = useRouter();
  const [showAuthDialog, setShowAuthDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<'chat' | 'profile' | null>(null);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [open, setOpen] = useState(false);
  const lastFetch = useRef<number>(0);

  // Handle authentication for map actions
  const handleAuthenticatedAction = (action: 'chat' | 'profile', result: SearchResult) => {
    if (!user) {
      setSelected(result);
      setPendingAction(action);
      setShowAuthDialog(true);
      return;
    }
    
    // User is authenticated, proceed with action
    if (action === 'chat') {
      router.push(`/chat?listing=${result.id}`);
    } else if (action === 'profile' && result.sellerId) {
      router.push(`/profile/${result.sellerId}`);
    }
  };

  const handleAuthDialogClose = () => {
    setShowAuthDialog(false);
    setPendingAction(null);
    setSelected(null);
  };

  const handleLoginRedirect = () => {
    setShowAuthDialog(false);
    router.push('/login');
  };

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current) return;
    if (initialized.current) return;

    try {
      // Set a default location in case geolocation fails
      const defaultLocation: [number, number] = [23.7275, 37.9838];
      
      // Initialize Mapbox token
      initializeMapbox();

      // Create map with default settings first
      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: defaultLocation,
        zoom: 6,
        attributionControl: false,
        // Disable WebWorkers for CSP compatibility
        interactive: true,
        antialias: true
      });
      initialized.current = true;
      
      // Add attribution control
      map.current.addControl(
        new mapboxgl.AttributionControl({ compact: true }),
        'bottom-right'
      );
      
      // Try to get user's location after map is already initialized
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setUserLocation([longitude, latitude]);

          if (map.current) {
            // Fly to user location
            map.current.flyTo({
              center: [longitude, latitude],
              zoom: 12,
              essential: true // Animation is essential to show users their location
            });
            
            // Add user location marker
            new mapboxgl.Marker({ color: '#FF0000' })
              .setLngLat([longitude, latitude])
              .setPopup(new mapboxgl.Popup().setHTML('<h3>Your Location</h3>'))
              .addTo(map.current);
            
            // Add navigation controls now that we know the map is working
            map.current.addControl(
              new mapboxgl.NavigationControl({ showCompass: false }),
              'top-right'
            );
          }
        },
        (error) => {
          console.warn('Error getting location:', error instanceof Error ? error.message : String(error));
        }
      );
    } catch (error) {
      console.warn('Error initializing map:', error instanceof Error ? error.message : String(error));
      setMapError(error instanceof Error ? error.message : 'Failed to initialize map');
    }

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!map.current || !live) return;
    const handler = async () => {
      const now = Date.now();
      if (now - lastFetch.current < 1200) return;
      lastFetch.current = now;
      const b = map.current!.getBounds();
      if (!b) return;
      const minLat = b.getSouth();
      const maxLat = b.getNorth();
      const minLon = b.getWest();
      const maxLon = b.getEast();
      try {
        const { supabase } = await import('@/lib/supabase/client');
        const { data, error } = await supabase.rpc('listings_in_view_detailed', { min_lat: minLat, min_lon: minLon, max_lat: maxLat, max_lon: maxLon });
        if (error) return;
        const fetched: SearchResult[] = (data || []).map((l: { id: string; title: string; description: string; price?: number; seller_id?: string; lon: number; lat: number }) => ({ id: l.id, title: l.title, description: l.description, price: l.price, sellerId: l.seller_id, location: { coordinates: [l.lon, l.lat] as [number, number], address: '' } }))
        // Remove existing markers
        markers.current.forEach(marker => marker.remove());
        markers.current = [];
        fetched.forEach(result => {
          const marker = new mapboxgl.Marker({ color: '#3B82F6', scale: 0.8 })
            .setLngLat(result.location.coordinates)
            .addTo(map.current!);
          marker.getElement().addEventListener('click', () => { setSelected(result); setOpen(true); });
          markers.current.push(marker);
        });
      } catch { /* noop */ }
    };
    map.current.on('moveend', handler);
    map.current.on('error', (e) => {
      const anyE = e as { error?: { message?: string } } | undefined
      const msg = (anyE && anyE.error && (anyE.error.message || String(anyE.error))) || 'Map error';
      setMapError(msg);
    });
    return () => { if (map.current) { map.current.off('moveend', handler); } };
  }, [live, mapError, user]);

  // Update markers when results change
  useEffect(() => {
    if (!map.current || mapError) return;

    try {
      // Remove existing markers
      markers.current.forEach(marker => marker.remove());
      markers.current = [];

      // Add new markers
      results.forEach(result => {
        const marker = new mapboxgl.Marker({
          color: '#3B82F6', // blue-500
          scale: 0.8
        })
          .setLngLat(result.location.coordinates)
          .addTo(map.current!);

        marker.getElement().addEventListener('click', () => {
          setSelected(result);
          setOpen(true);
        });

        // Add visual indicator for authentication requirement
        if (!user) {
          marker.getElement().style.cursor = 'pointer';
          marker.getElement().title = 'Click to view (login required for actions)';
        }

        markers.current.push(marker);
      });

      // Fit bounds to include all markers if there are results
      if (results.length > 0) {
        const bounds = new mapboxgl.LngLatBounds();
        results.forEach(result => {
          bounds.extend(result.location.coordinates);
        });
        // Also include user location in bounds
        bounds.extend(userLocation);
        
        map.current.fitBounds(bounds, {
          padding: { top: 50, bottom: 50, left: 50, right: 50 },
          maxZoom: 15,
          duration: 1000 // Smooth animation
        });
      }
    } catch (error) {
      console.warn('Error updating markers:', error instanceof Error ? error.message : String(error));
      setMapError('Failed to update map markers');
    }
  }, [results, userLocation, mapError, user]);

  if (mapError) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-lg">
        <div className="text-center p-4">
          <p className="text-red-500 mb-2">{mapError}</p>
          <p className="text-sm text-gray-500">Please check your configuration and try again</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div ref={mapContainer} className="w-full h-full min-h-[400px]" />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selected?.title}</DialogTitle>
            <DialogDescription>
              {selected?.description}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 space-y-2">
            {selected?.price !== undefined && (
              <div className="text-sm font-medium">${selected.price!.toFixed(2)}</div>
            )}
            {selected?.sellerRating !== undefined && (
              <div className="text-xs text-gray-600">Seller rating: {Number(selected.sellerRating).toFixed(2)}</div>
            )}
            <div className="text-sm text-gray-500">{selected?.location.address}</div>
            <div className="flex gap-2 pt-2">
              {!user ? (
                <div className="text-sm text-gray-600 mb-2 w-full">
                  <p>Please log in to access these features:</p>
                </div>
              ) : null}
              
              <Button 
                onClick={() => handleAuthenticatedAction('chat', selected!)}
                className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-white hover:bg-blue-700"
                disabled={!selected}
              >
                Chat
              </Button>
              
              <Button 
                onClick={() => handleAuthenticatedAction('profile', selected!)}
                className="inline-flex items-center rounded-md bg-gray-200 px-3 py-2 text-gray-900 hover:bg-gray-300"
                disabled={!selected?.sellerId}
              >
                View Profile
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Authentication Dialog */}
      <Dialog open={showAuthDialog} onOpenChange={handleAuthDialogClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Login Required</DialogTitle>
            <DialogDescription>
              You need to be logged in to {pendingAction === 'chat' ? 'start a chat' : 'view seller profiles'}. 
              Please log in or create an account to continue.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 pt-4">
            <Button onClick={handleLoginRedirect} className="flex-1">
              Log In
            </Button>
            <Button 
              variant="outline" 
              onClick={handleAuthDialogClose}
              className="flex-1"
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
