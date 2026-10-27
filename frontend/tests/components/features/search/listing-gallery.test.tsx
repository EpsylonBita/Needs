import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ locale: 'en', reducedMotion: false }));
vi.mock('@/contexts/i18n-context', () => ({ useI18n: () => ({ locale: state.locale }) }));
// The test double exposes native image load/error events without Next's image loader.
// eslint-disable-next-line @next/next/no-img-element
vi.mock('next/image', () => ({ default: ({ src, alt, onError, className }: React.ImgHTMLAttributes<HTMLImageElement>) => <img src={src} alt={alt} onError={onError} className={className} /> }));
vi.mock('framer-motion', async importOriginal => ({
  ...await importOriginal<typeof import('framer-motion')>(),
  useReducedMotion: () => state.reducedMotion,
}));

import { ListingGallery } from '@/components/features/search/listing-gallery';

const images = [{ url: '/first-photo.jpg' }, { url: '/second-photo.jpg' }];
beforeEach(() => { state.locale = 'en'; state.reducedMotion = false; });
afterEach(cleanup);

describe('Listing photo gallery', () => {
  it.each([false, true])('switches the main photo with the keyboard and announces the selected photo (reduced motion: %s)', async reducedMotion => {
    state.reducedMotion = reducedMotion;
    const user = userEvent.setup();
    render(<ListingGallery title="Oak desk" images={images} />);
    expect(screen.getByRole('img', { name: 'Oak desk · 1' })).toHaveAttribute('src', '/first-photo.jpg');
    expect(screen.getByRole('button', { name: 'View photo 1' })).toHaveAttribute('aria-pressed', 'true');
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'View photo 2' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'View photo 2' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'View photo 1' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Photo 2 of 2')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('img', { name: 'Oak desk · 2' })).toHaveAttribute('src', '/second-photo.jpg');
    await waitFor(() => expect(screen.queryByRole('img', { name: 'Oak desk · 1' })).not.toBeInTheDocument());
  });

  it('keeps the gallery usable when a photo fails', async () => {
    render(<ListingGallery title="Oak desk" images={images} />);
    fireEvent.error(screen.getByRole('img', { name: 'Oak desk · 1' }));
    expect(screen.getByText('This photo is unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View photo 2' }));
    expect(screen.getByRole('img', { name: 'Oak desk · 2' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('This photo is unavailable')).not.toBeInTheDocument());
  });

  it('handles a single photo and listings without photos without empty controls', () => {
    const view = render(<ListingGallery title="Oak desk" images={[images[0]]} />);
    expect(screen.getByRole('img', { name: 'Oak desk · 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    view.rerender(<ListingGallery title="Oak desk" images={[]} />);
    expect(screen.getByText('No photos added')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('uses Greek labels and falls back to the new cover if the image set changes', () => {
    state.locale = 'el';
    const view = render(<ListingGallery title="Γραφείο" images={images} />);
    fireEvent.click(screen.getByRole('button', { name: 'Προβολή φωτογραφίας 2' }));
    expect(screen.getByText('Φωτογραφία 2 από 2')).toBeInTheDocument();
    view.rerender(<ListingGallery title="Καρέκλα" images={[{ url: '/chair.jpg' }]} />);
    expect(screen.getByRole('img', { name: 'Καρέκλα · 1' })).toHaveAttribute('src', '/chair.jpg');
    expect(screen.getByText('Φωτογραφία 1 από 1')).toBeInTheDocument();
  });
});
