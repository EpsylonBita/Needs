import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const renderer = vi.hoisted(() => {
  let release!: () => void;
  const loaded = new Promise<void>(resolve => { release = resolve; });
  return { loaded, release, fail: false };
});

vi.mock('@/components/features/map/map-component', async () => {
  await renderer.loaded;
  return { Map: ({ returnTo }: { returnTo?: string }) => {
    if (renderer.fail) throw new Error('Renderer failed');
    return <div data-testid="loaded-map">{returnTo}</div>;
  } };
});

import { MapLoader } from '@/components/features/map/map-loader';

afterEach(() => { cleanup(); renderer.fail = false; vi.restoreAllMocks(); });

describe('bounded browser map loading', () => {
  it('turns a stalled chunk into a recoverable error and retries without losing the destination', async () => {
    let expire: (() => void) | undefined;
    const schedule = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay === 15_000) expire = callback as () => void;
      return schedule(callback, delay, ...args);
    }) as typeof setTimeout);
    const onStatusChange = vi.fn();
    render(<MapLoader results={[]} returnTo="/search?q=guitar" onStatusChange={onStatusChange} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading map');
    act(() => expire?.());
    expect(screen.getByRole('status')).toHaveTextContent('You can still explore the listings');
    expect(onStatusChange).toHaveBeenLastCalledWith('error');
    await act(async () => renderer.release());
    expect(screen.queryByTestId('loaded-map')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByTestId('loaded-map')).toHaveTextContent('/search?q=guitar'));
  });

  it('isolates renderer exceptions so the surrounding list remains usable and a retry can recover', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderer.fail = true;
    const onStatusChange = vi.fn();
    render(<><button>Open listing</button><MapLoader results={[]} onStatusChange={onStatusChange} /></>);
    await screen.findByRole('button', { name: 'Try again' });
    expect(screen.getByRole('button', { name: 'Open listing' })).toBeEnabled();
    expect(onStatusChange).toHaveBeenLastCalledWith('error');
    renderer.fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByTestId('loaded-map');
  });
});
