import { useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

interface MapOptions {
  center: [number, number];
  zoom: number;
  onClick?: (event: mapboxgl.MapMouseEvent) => void;
}

export function useMap() {
  const [map, setMap] = useState<mapboxgl.Map | null>(null);
  const [marker, setMarker] = useState<mapboxgl.Marker | null>(null);

  const initializeMap = useCallback((containerId: string, options: MapOptions) => {
    if (map) return; // Map already initialized

    const newMap = new mapboxgl.Map({
      container: containerId,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: options.center,
      zoom: options.zoom,
      accessToken: process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
    });

    // Add navigation controls
    newMap.addControl(new mapboxgl.NavigationControl(), 'top-right');

    // Add click handler
    if (options.onClick) {
      newMap.on('click', options.onClick);
    }

    // Create marker but don't add it yet
    const newMarker = new mapboxgl.Marker({
      color: '#3B82F6', // blue-500
      draggable: true,
    });

    // Handle marker dragend
    newMarker.on('dragend', () => {
      const lngLat = newMarker.getLngLat();
      options.onClick?.({
        lngLat,
        point: newMap.project(lngLat),
        type: 'click',
        target: newMap,
        originalEvent: new MouseEvent('click'),
      } as mapboxgl.MapMouseEvent);
    });

    setMap(newMap);
    setMarker(newMarker);

    return () => {
      newMap.remove();
      setMap(null);
      setMarker(null);
    };
  }, [map]);

  const updateMarker = useCallback((coordinates: [number, number]) => {
    if (!map || !marker) return;

    marker.setLngLat(coordinates).addTo(map);
  }, [map, marker]);

  return {
    map,
    marker,
    initializeMap,
    updateMarker,
  };
} 