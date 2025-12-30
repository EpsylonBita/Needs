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
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) {
    throw new Error('Mapbox token is missing. Please add NEXT_PUBLIC_MAPBOX_TOKEN to your .env.local file');
  }
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
}

interface MapProps {
  results: SearchResult[];
}

export function Map({ results }: MapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<mapboxgl.Marker[]>([]);
  const [userLocation, setUserLocation] = useState<[number, number]>([0, 0]);
  const [mapError, setMapError] = useState<string | null>(null);
  const { user } = useAuth();
  const router = useRouter();
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [showAuthDialog, setShowAuthDialog] = useState(false);
  const [_pendingAction, setPendingAction] = useState<'chat' | 'profile' | null>(null);

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

    try {
      // Initialize Mapbox token
      initializeMapbox();

      // Get user's location
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setUserLocation([longitude, latitude]);

          // Initialize map with user's location
          if (mapContainer.current) {
            map.current = new mapboxgl.Map({
              container: mapContainer.current,
              style: 'mapbox://styles/mapbox/streets-v12',
              center: [longitude, latitude],
              zoom: 12,
              attributionControl: false // Hide attribution for cleaner look
            });
          }

          // Add user location marker
          if (map.current) {
            new mapboxgl.Marker({ color: '#FF0000' })
              .setLngLat([longitude, latitude])
              .setPopup(new mapboxgl.Popup().setHTML('<h3>Your Location</h3>'))
              .addTo(map.current);

            // Add navigation controls
            map.current.addControl(
              new mapboxgl.NavigationControl({ showCompass: false }),
              'top-right'
            );

            // Add attribution control
            map.current.addControl(
              new mapboxgl.AttributionControl({ compact: true }),
              'bottom-right'
            );
          }
        },
        (error) => {
          console.error('Error getting location:', error);
          // Default to a central location if geolocation fails
          const defaultLocation: [number, number] = [23.7275, 37.9838];
          setUserLocation(defaultLocation);

          map.current = new mapboxgl.Map({
            container: mapContainer.current!,
            style: 'mapbox://styles/mapbox/streets-v12',
            center: defaultLocation,
            zoom: 6,
            attributionControl: false
          });

          map.current.addControl(
            new mapboxgl.NavigationControl({ showCompass: false }),
            'top-right'
          );

          map.current.addControl(
            new mapboxgl.AttributionControl({ compact: true }),
            'bottom-right'
          );
        }
      );
    } catch (error) {
      console.error('Error initializing map:', error);
      setMapError(error instanceof Error ? error.message : 'Failed to initialize map');
    }

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, []);

  // Update markers when results change
  useEffect(() => {
    if (!map.current || mapError) return;

    try {
      const escapeHtml = (input: string) => {
        const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
        return String(input).replace(/[&<>"']/g, (c) => map[c])
      }
      // Remove existing markers
      markers.current.forEach(marker => marker.remove());
      markers.current = [];

      // Add new markers
      results.forEach(result => {
        const safeTitle = escapeHtml(result.title)
        const safeAddress = escapeHtml(result.location.address)
        const priceHtml = typeof result.price === 'number' ? `<p class="text-blue-500">$${Number(result.price).toFixed(2)}</p>` : ''
        const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(
          `<div class="p-2">\n`+
          `  <h3 class="font-semibold">${safeTitle}</h3>\n`+
          `  ${priceHtml}\n`+
          `  <p class="text-sm text-gray-500">${safeAddress}</p>\n`+
          `</div>`
        );

        const marker = new mapboxgl.Marker({
          color: '#3B82F6', // blue-500
          scale: 0.8
        })
          .setLngLat(result.location.coordinates)
          .setPopup(popup)
          .addTo(map.current!);

        // Add authentication-aware click handler
        marker.getElement().addEventListener('click', (e) => {
          e.stopPropagation();
          if (!user) {
            setSelected(result);
            setShowAuthDialog(true);
          } else {
            // User is authenticated, show full options
            setSelected(result);
            setShowAuthDialog(true);
          }
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
      console.error('Error updating markers:', error);
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
      <div ref={mapContainer} className="w-full h-full" />
      
      {/* Authentication Dialog */}
      <Dialog open={showAuthDialog} onOpenChange={handleAuthDialogClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{user ? 'Listing Details' : 'Login Required'}</DialogTitle>
            <DialogDescription>
              {user 
                ? selected 
                  ? `View details for "${selected.title}"` 
                  : 'View listing details and actions'
                : 'You need to be logged in to access this feature. Please log in to continue.'
              }
            </DialogDescription>
          </DialogHeader>
          
          {selected && (
            <div className="space-y-3">
              <div>
                <h4 className="font-medium">{selected.title}</h4>
                {selected.price && (
                  <p className="text-blue-600 font-semibold">${selected.price.toFixed(2)}</p>
                )}
                <p className="text-sm text-gray-600">{selected.location.address}</p>
                <p className="text-sm text-gray-500 mt-1">{selected.description}</p>
              </div>
              
              {user ? (
                <div className="flex gap-2">
                  <Button 
                    size="sm" 
                    onClick={() => handleAuthenticatedAction('chat', selected)}
                  >
                    Chat
                  </Button>
                  {selected.sellerId && (
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => handleAuthenticatedAction('profile', selected)}
                    >
                      View Profile
                    </Button>
                  )}
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button onClick={handleLoginRedirect}>
                    Go to Login
                  </Button>
                  <Button variant="outline" onClick={handleAuthDialogClose}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
