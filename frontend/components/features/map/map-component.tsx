'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from 'next-themes';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

import { Button } from '@/components/ui/button';
import { useI18n } from '@/contexts/i18n-context';
import { MapListingPreview, type MapListing } from './map-listing-preview';
import { formatPublishedListingPrice, listingPriceNeedsConfirmation } from '@/lib/listings/price-policy';

interface SearchResult extends MapListing {
  sellerId?: string;
  sellerRating?: number;
}

interface MapProps { results: SearchResult[]; live?: boolean }

function validCoordinates(result: SearchResult) {
  const [longitude, latitude] = result.location.coordinates;
  return Number.isFinite(longitude) && Number.isFinite(latitude) && Math.abs(longitude) <= 180 && Math.abs(latitude) <= 90;
}

export function Map({ results, live = false }: MapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<{ marker: mapboxgl.Marker; button: HTMLButtonElement; id: string }[]>([]);
  const popup = useRef<mapboxgl.Popup | null>(null);
  const focusPreview = useRef(false);
  const [mapError, setMapError] = useState(false);
  const [listingsError, setListingsError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [liveResults, setLiveResults] = useState<SearchResult[] | null>(null);
  const { t, locale } = useI18n();
  const { resolvedTheme } = useTheme();
  const style = resolvedTheme === 'dark' ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/streets-v12';
  const latestStyle = useRef(style);
  const appliedStyle = useRef(style);
  useLayoutEffect(() => { latestStyle.current = style; }, [style]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [popupTarget, setPopupTarget] = useState<HTMLDivElement | null>(null);
  const visibleResults = live ? liveResults ?? results : results;
  const selected = visibleResults.find(result => result.id === selectedId) ?? null;
  const closePreview = useCallback(() => {
    markers.current.find(item => item.id === selectedId)?.button.focus();
    setSelectedId(null);
  }, [selectedId]);

  useEffect(() => {
    if (!mapContainer.current) return;
    let current: mapboxgl.Map | null = null;
    let resizeObserver: ResizeObserver | undefined;
    const onError = () => setMapError(true);
    setMapError(false);
    try {
      const token = (process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '').trim();
      if (!token) throw new Error('Map unavailable');
      mapboxgl.accessToken = token;
      current = new mapboxgl.Map({
        container: mapContainer.current,
        style: latestStyle.current,
        center: [23.7275, 37.9838],
        zoom: 10,
        attributionControl: false,
        interactive: true,
        antialias: true,
        locale: {
          'Map.Title': t('map.title', 'Listings on the map'),
          'NavigationControl.ZoomIn': t('map.zoomIn', 'Zoom in'),
          'NavigationControl.ZoomOut': t('map.zoomOut', 'Zoom out'),
          'NavigationControl.ResetBearing': t('map.resetBearing', 'Reset map orientation'),
          'GeolocateControl.FindMyLocation': t('map.locate', 'Find my location'),
          'GeolocateControl.LocationNotAvailable': t('map.locationUnavailable', 'Your location is unavailable'),
          'AttributionControl.ToggleAttribution': t('map.attribution', 'Map attribution'),
        },
      });
      map.current = current;
      appliedStyle.current = latestStyle.current;
      // Listen in both search and live views; errors never expose provider configuration.
      current.on('error', onError);
      current.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
      current.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
      // Mapbox requests location only when this button is pressed. Do not call trigger().
      current.addControl(new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: false, timeout: 10_000 },
        trackUserLocation: false,
        showUserLocation: true,
        fitBoundsOptions: { maxZoom: 14, essential: false },
      }), 'top-right');
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => {
          if (map.current === current) current?.resize();
        });
        resizeObserver.observe(mapContainer.current);
      }
    } catch {
      setMapError(true);
    }
    return () => {
      resizeObserver?.disconnect();
      markers.current.forEach(({ marker }) => marker.remove());
      markers.current = [];
      current?.off('error', onError);
      current?.remove();
      if (map.current === current) map.current = null;
    };
  }, [t, attempt]);

  useEffect(() => {
    if (map.current && appliedStyle.current !== style) {
      map.current.setStyle(style);
      appliedStyle.current = style;
    }
  }, [style, attempt]);

  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null);
  }, [selectedId, selected]);

  useEffect(() => {
    const current = map.current;
    if (!current || !live) return;
    let active = true;
    let request = 0;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const bounds = current.getBounds();
      if (!bounds) return;
      const requestId = ++request;
      try {
        const { supabase } = await import('@/lib/supabase/client');
        const { data, error } = await supabase.rpc('listings_in_view_detailed', {
          min_lat: bounds.getSouth(), min_lon: bounds.getWest(), max_lat: bounds.getNorth(), max_lon: bounds.getEast(),
        });
        if (!active || requestId !== request) return;
        if (error) { setListingsError(true); return; }
        const items: SearchResult[] = (data || []).map((listing: { id: string; title: string; description: string; price?: number; seller_id?: string; lon: number; lat: number }) => ({
          id: listing.id, title: listing.title, description: listing.description, price: listing.price,
          sellerId: listing.seller_id, location: { coordinates: [listing.lon, listing.lat], address: '' },
        }));
        // Enrich only the visible IDs; the bounds RPC remains the source of map results.
        if (items.length) {
          try {
            const details = await supabase.from('listings').select('id,address,main_category,sub_category,listing_images(url,main)').in('id', items.map(item => item.id));
            if (!active || requestId !== request) return;
            if (!details.error) {
              for (const item of items) {
                const detail = details.data?.find(row => row.id === item.id);
                if (!detail) continue;
                item.category = detail.main_category;
                item.subcategory = detail.sub_category;
                item.imageUrl = detail.listing_images?.find((image: { main: boolean; url: string }) => image.main)?.url || detail.listing_images?.[0]?.url;
                item.location.address = typeof detail.address === 'string' ? detail.address : detail.address?.label || '';
              }
            }
          } catch { /* A missing photo must not remove an otherwise available listing. */ }
        }
        if (!active || requestId !== request) return;
        setListingsError(false);
        setLiveResults(items);
      } catch { if (active && requestId === request) setListingsError(true); }
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(refresh, 350); };
    current.on('load', refresh);
    current.on('moveend', schedule);
    if (current.loaded()) void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
      current.off('load', refresh);
      current.off('moveend', schedule);
    };
  }, [live, t, attempt]);

  const replaceMarkers = useCallback((items: SearchResult[]) => {
    const current = map.current;
    if (!current) return;
    markers.current.forEach(({ marker }) => marker.remove());
    markers.current = [];
    items.filter(validCoordinates).forEach(result => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'needs-map-price-marker';
      const price = result.price === 0 && !listingPriceNeedsConfirmation(result.price, result.description, result.category, result.subcategory) ? t('map.free', 'Free') : typeof result.price === 'number' && Number.isFinite(result.price) ? formatPublishedListingPrice(result.price, result.description, locale, result.category, result.subcategory, { notation: 'compact', maximumFractionDigits: 1 }) : t('map.priceOnRequest', 'Ask for price');
      button.setAttribute('aria-label', `${t('map.openListing', 'View listing: {title}').replace('{title}', result.title)} · ${price}`);
      button.setAttribute('role', 'button');
      button.setAttribute('aria-haspopup', 'dialog');
      button.setAttribute('aria-expanded', 'false');
      button.dataset.selected = 'false';
      const label = document.createElement('span');
      label.className = 'needs-map-price-label';
      label.textContent = price;
      button.appendChild(label);
      button.addEventListener('click', event => {
        event.stopPropagation();
        focusPreview.current = event.detail === 0;
        const activeClose = popup.current?.getElement()?.querySelector<HTMLButtonElement>('.needs-map-preview-close');
        if (focusPreview.current && button.getAttribute('aria-expanded') === 'true' && activeClose?.isConnected) {
          activeClose.focus();
          focusPreview.current = false;
          return;
        }
        setSelectedId(result.id);
      });
      const marker = new mapboxgl.Marker({ element: button }).setLngLat(result.location.coordinates).addTo(current);
      // Preserve native button semantics even if Mapbox assigns its default marker role.
      button.setAttribute('role', 'button');
      markers.current.push({ marker, button, id: result.id });
    });
  }, [t, locale]);

  useEffect(() => {
    const current = map.current;
    if (!current) return;
    const items = (live ? liveResults ?? results : results).filter(validCoordinates);
    replaceMarkers(items);
    if (!live && items.length) {
      const bounds = new mapboxgl.LngLatBounds();
      items.forEach(result => bounds.extend(result.location.coordinates));
      // Fit actual listings only. Including an unset [0, 0] used to zoom out to another continent.
      current.fitBounds(bounds, { padding: 50, maxZoom: 15, duration: 0, essential: false });
    }
  }, [results, live, liveResults, replaceMarkers, attempt]);

  useEffect(() => {
    markers.current.forEach(({ button, id }) => {
      const active = id === selectedId && !!selected;
      button.dataset.selected = String(active);
      button.setAttribute('aria-expanded', String(active));
    });
  }, [selected, selectedId, results, liveResults, attempt]);

  useLayoutEffect(() => {
    const current = map.current;
    if (!current || !selected || mapError) return;
    const host = document.createElement('div');
    host.addEventListener('click', event => event.stopPropagation());
    const smallCanvas = !!mapContainer.current?.clientHeight && mapContainer.current.clientHeight < 400;
    const currentPopup = new mapboxgl.Popup({ className: 'needs-map-popup', closeButton: false, closeOnClick: true, focusAfterOpen: false, maxWidth: '300px', offset: 24, ...(smallCanvas ? { anchor: 'bottom' as const } : {}) })
      .setLngLat(selected.location.coordinates).setDOMContent(host).addTo(current);
    popup.current = currentPopup;
    setPopupTarget(host);
    const onClose = () => { if (popup.current === currentPopup) setSelectedId(null); };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closePreview(); }
    };
    currentPopup.on('close', onClose);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      currentPopup.off('close', onClose);
      currentPopup.remove();
      if (popup.current === currentPopup) popup.current = null;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [selected, closePreview, mapError, attempt]);

  useLayoutEffect(() => {
    if (!popupTarget || !selected || !popup.current) return;
    const currentPopup = popup.current;
    // A reopen briefly retains the previous host until the new portal commits.
    if (!currentPopup.getElement()?.contains(popupTarget)) return;
    const currentMap = map.current;
    let frame = 0;
    let remainingCorrections = 0;
    const keepPreviewVisible = () => {
      const canvas = mapContainer.current;
      const element = currentPopup.getElement();
      if (!canvas || !element || popup.current !== currentPopup || map.current !== currentMap || !currentMap || remainingCorrections <= 0) return;
      const bounds = canvas.getBoundingClientRect();
      const card = element.getBoundingClientRect();
      if (!bounds.width || !bounds.height || !card.width || !card.height) return;
      const horizontal = card.left < bounds.left + 12 ? card.left - bounds.left - 12 : card.right > bounds.right - 12 ? card.right - bounds.right + 12 : 0;
      const vertical = card.top < bounds.top + 12 ? card.top - bounds.top - 12 : card.bottom > bounds.bottom - 12 ? card.bottom - bounds.bottom + 12 : 0;
      if (Math.abs(horizontal) < 1 && Math.abs(vertical) < 1) return;
      remainingCorrections -= 1;
      currentMap.panBy([horizontal, vertical], { duration: 0, animate: false, essential: false });
      // A short map uses a fixed bottom anchor, so correcting its position cannot flip it.
      // Bound the second measurement for larger maps whose automatic anchor may change.
      frame = requestAnimationFrame(keepPreviewVisible);
    };
    const resizePreview = () => {
      const canvas = mapContainer.current;
      if (!canvas || popup.current !== currentPopup) return;
      if (canvas.clientWidth) popupTarget.style.setProperty('--needs-map-preview-width', `${Math.max(0, Math.min(292, canvas.clientWidth - 24))}px`);
      if (canvas.clientHeight) popupTarget.style.setProperty('--needs-map-preview-max-height', `${Math.max(0, canvas.clientHeight - 24)}px`);
      // Mapbox initially measured an empty host; update the anchor after the portal commits.
      currentPopup.setLngLat(selected.location.coordinates);
      cancelAnimationFrame(frame);
      remainingCorrections = 2;
      frame = requestAnimationFrame(keepPreviewVisible);
    };
    resizePreview();
    if (focusPreview.current) {
      popupTarget.querySelector<HTMLButtonElement>('.needs-map-preview-close')?.focus();
      focusPreview.current = false;
    }
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resizePreview) : null;
    if (mapContainer.current) observer?.observe(mapContainer.current);
    return () => { observer?.disconnect(); cancelAnimationFrame(frame); };
  }, [popupTarget, selected, selectedId, results, liveResults]);

  return (
    <>
      <div className="relative h-full w-full">
        <div ref={mapContainer} aria-label={t('map.title', 'Listings on the map')} aria-hidden={mapError || undefined} className={`h-full w-full [&_.mapboxgl-ctrl-group_button]:h-11 [&_.mapboxgl-ctrl-group_button]:w-11 ${mapError ? 'invisible' : ''}`} />
        {mapError && (
          <div role="status" className="absolute inset-0 flex items-center justify-center rounded-lg bg-muted p-6 text-center">
            <div className="max-w-sm space-y-3">
              <p className="font-medium text-foreground">{t('map.unavailable', 'The map is temporarily unavailable')}</p>
              <p className="text-sm text-muted-foreground">{t('map.unavailableHint', 'You can still explore the listings in the results.')}</p>
              <Button variant="outline" onClick={() => setAttempt(value => value + 1)}>{t('map.retry', 'Try again')}</Button>
            </div>
          </div>
        )}
        {live && listingsError && !mapError && <p role="status" className="absolute bottom-10 left-3 right-3 rounded-lg bg-background/95 p-3 text-sm shadow">{t('map.listingsError', 'Nearby listings could not be refreshed. Move the map to try again.')}</p>}
      </div>
      {popupTarget && selected && !mapError && createPortal(<MapListingPreview key={selected.id} listing={selected} onClose={closePreview} />, popupTarget)}
    </>
  );
}
