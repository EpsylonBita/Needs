'use client';

import { Component, type ComponentType, type ReactNode, useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/contexts/i18n-context';
import type { MapProps } from './map-component';

class MapBoundary extends Component<{ children: ReactNode; fallback: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure(); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** Load the browser-only renderer without letting a stalled or broken chunk block the list. */
export function MapLoader(props: MapProps) {
  const { t } = useI18n();
  const [MapComponent, setMapComponent] = useState<ComponentType<MapProps> | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const fail = useCallback(() => setLoadError(true), []);
  const retry = () => {
    setMapComponent(null);
    setLoadError(false);
    setAttempt(value => value + 1);
  };

  useEffect(() => {
    let active = true;
    const timeout = setTimeout(() => { if (active) { active = false; setLoadError(true); } }, 15_000);
    void import('./map-component').then(module => {
      if (!active) return;
      clearTimeout(timeout);
      setMapComponent(() => module.Map);
    }).catch(() => {
      if (!active) return;
      clearTimeout(timeout);
      setLoadError(true);
    });
    return () => { active = false; clearTimeout(timeout); };
  }, [attempt]);

  const onStatusChange = props.onStatusChange;
  useEffect(() => {
    if (loadError) onStatusChange?.('error');
    else if (!MapComponent) onStatusChange?.('loading');
  }, [loadError, MapComponent, onStatusChange]);

  const fallback = <div role="status" data-map-status="error" data-map-error="module" className="flex h-full items-center justify-center overflow-auto rounded-lg bg-muted p-4 text-center">
    <div className="max-w-sm space-y-3">
      <p className="font-medium text-foreground">{t('map.unavailable', 'The map is temporarily unavailable')}</p>
      <p className="text-sm text-muted-foreground">{t('map.unavailableHint', 'You can still explore the listings in the results.')}</p>
      <Button variant="outline" onClick={retry}>{t('map.retry', 'Try again')}</Button>
    </div>
  </div>;
  if (loadError) return fallback;
  if (!MapComponent) return <div role="status" data-map-status="loading" className="flex h-full items-center justify-center bg-muted/50 p-4 text-sm text-muted-foreground">{t('map.loading', 'Loading map…')}</div>;
  return <MapBoundary key={attempt} fallback={fallback} onFailure={fail}><MapComponent {...props} /></MapBoundary>;
}
