import { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useTheme } from 'next-themes';

interface MapOptions {
  center: [number, number];
  zoom: number;
  onClick?: (event: mapboxgl.MapMouseEvent) => void;
}

export function useMap() {
  const [map, setMap] = useState<mapboxgl.Map | null>(null);
  const [marker, setMarker] = useState<mapboxgl.Marker | null>(null);
  const instance = useRef<mapboxgl.Map | null>(null);
  useEffect(() => () => { instance.current?.remove(); instance.current = null; }, []);
  const { resolvedTheme } = useTheme();
  const style = resolvedTheme === 'dark' ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/streets-v12';
  const latestStyle = useRef(style);
  const appliedStyle = useRef(style);
  useLayoutEffect(() => { latestStyle.current = style; }, [style]);

  useEffect(() => {
    if (map && appliedStyle.current !== style) {
      // Style changes retain the viewport and the DOM marker's selected location.
      map.setStyle(style);
      appliedStyle.current = style;
    }
  }, [map, style]);

  const initializeMap = useCallback((containerId: string, options: MapOptions) => {
    if (instance.current) return; // Also guard calls before the next render.

    const newMap = new mapboxgl.Map({
      container: containerId,
      style: latestStyle.current,
      center: options.center,
      zoom: options.zoom,
      accessToken: process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
      performanceMetricsCollection: false,
    });
    instance.current = newMap;
    appliedStyle.current = latestStyle.current;

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
      if (instance.current !== newMap) return;
      newMap.remove();
      instance.current = null;
      setMap(null);
      setMarker(null);
    };
  }, []);

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
