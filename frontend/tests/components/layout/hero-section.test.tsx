import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ push: vi.fn(), reducedMotion: false }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('@/components/features/ads/new-listing-button', () => ({ NewListingButton: ({ children, intent }: { children: React.ReactNode; intent: string }) => <button data-intent={intent}>{children}</button> }));
vi.mock('next/image', () => ({ default: ({ src, alt, className }: { src: string; alt: string; className: string }) => <img src={src} alt={alt} className={className} /> }));
vi.mock('@/contexts/i18n-context', () => ({ useI18n: () => ({ t: (key: string, fallback?: string) => ({ 'modern.hero.title': 'Everything you need.', 'modern.hero.accent': 'Closer to you.' }[key] || fallback || key) }) }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => state.reducedMotion,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
    span: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  },
}));

import { HeroSection } from '@/components/layout/hero-section';

beforeEach(() => {
  vi.useFakeTimers();
  state.push.mockReset();
  state.reducedMotion = false;
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Athens homepage hero', () => {
  it('preserves the original photograph and navigates with a trimmed, correctly encoded search query', () => {
    render(<HeroSection />);
    expect(screen.getByRole('img', { name: 'Athens, the Acropolis and the sea' })).toHaveAttribute('src', '/athens.jpg');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Everything you need. Closer to you.');
    expect(screen.getByRole('button', { name: 'I need something' })).toHaveAttribute('data-intent', 'request');
    expect(screen.getByRole('button', { name: 'I have something to offer' })).toHaveAttribute('data-intent', 'offer');
    fireEvent.change(screen.getByRole('searchbox', { name: 'What are you looking for?' }), { target: { value: '  guitar & lessons / Αθήνα?  ' } });
    fireEvent.submit(screen.getByRole('search'));
    expect(state.push).toHaveBeenCalledWith('/search?q=guitar+%26+lessons+%2F+%CE%91%CE%B8%CE%AE%CE%BD%CE%B1%3F');
  });

  it('opens all search results for a blank query', () => {
    render(<HeroSection />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '   ' } });
    fireEvent.submit(screen.getByRole('search'));
    expect(state.push).toHaveBeenCalledWith('/search');
  });

  it('shows typing, then one message, and fully removes it before the next location', () => {
    const view = render(<HeroSection />);
    const bubble = () => view.container.querySelector('.needs-city-bubble');
    const example = () => view.container.querySelector('.needs-city-example[data-phase]');
    const message = () => view.container.querySelector('.needs-city-message');
    const seenMessages: string[] = [];
    const expectOneBubble = (phase: string) => {
      expect(view.container.querySelectorAll('.needs-city-example[data-phase]')).toHaveLength(1);
      expect(view.container.querySelectorAll('.needs-city-bubble')).toHaveLength(1);
      expect(example()).toHaveAttribute('data-phase', phase);
    };
    for (let location = 0; location < 4; location++) {
      expectOneBubble('typing');
      expect(bubble()).toHaveClass('is-typing');
      expect(message()).not.toBeInTheDocument();
      advance(1399);
      expectOneBubble('typing');
      advance(1);
      expectOneBubble('message');
      expect(bubble()).not.toHaveClass('is-typing');
      expect(message()?.textContent?.trim()).toBeTruthy();
      const content = message()!.textContent!;
      seenMessages.push(content);
      advance(3600);
      expectOneBubble('leaving');
      expect(message()).toHaveTextContent(content);
      advance(280);
      expect(example()).not.toBeInTheDocument();
      expect(bubble()).not.toBeInTheDocument();
      expect(message()).not.toBeInTheDocument();
      advance(179);
      expect(bubble()).not.toBeInTheDocument();
      advance(1);
    }
    expect(new Set(seenMessages).size).toBe(4);
    expectOneBubble('typing');
    advance(1400);
    expect(message()!.textContent).toBe(seenMessages[0]);
  });

  it.each(['typing', 'message'] as const)('freezes the current %s phase and heading when paused, then restarts that phase on resume', phase => {
    const view = render(<HeroSection />);
    advanceToNextLocation();
    if (phase === 'message') advance(1400);
    const example = () => view.container.querySelector('.needs-city-example[data-phase]');
    const examples = () => view.container.querySelector('.needs-city-examples');
    const heading = () => view.container.querySelector('.needs-city-phrase')?.textContent;
    const content = examples()!.textContent;
    const headingBeforePause = heading();
    expect(example()).toHaveAttribute('data-phase', phase);
    advance(500);
    fireEvent.click(screen.getByRole('button', { name: 'Pause animations' }));
    expect(screen.getByRole('button', { name: 'Play animations' })).toHaveAttribute('aria-pressed', 'true');
    expect(examples()).toHaveAttribute('data-paused', 'true');
    advance(18_000);
    expect(example()).toHaveAttribute('data-phase', phase);
    expect(examples()!.textContent).toBe(content);
    expect(heading()).toBe(headingBeforePause);
    expect(view.container.querySelectorAll('.needs-city-bubble')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Play animations' }));
    const duration = phase === 'typing' ? 1400 : 3600;
    advance(duration - 1);
    expect(example()).toHaveAttribute('data-phase', phase);
    advance(1);
    expect(example()).toHaveAttribute('data-phase', phase === 'typing' ? 'message' : 'leaving');
  });

  it('shows one complete static message without a phase timer when reduced motion is requested', () => {
    state.reducedMotion = true;
    const schedule = createTimeoutSpy();
    const view = render(<HeroSection />);
    expect(phaseTimerHandles(schedule)).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /animations/ })).not.toBeInTheDocument();
    expect(view.container.querySelectorAll('.needs-city-bubble')).toHaveLength(1);
    expect(view.container.querySelector('.needs-city-example')).toHaveAttribute('data-phase', 'message');
    expect(view.container.querySelector('.needs-city-bubble.is-typing')).not.toBeInTheDocument();
    const content = view.container.querySelector('.needs-city-message')?.textContent;
    expect(content?.trim()).toBeTruthy();
    advance(18_000);
    expect(view.container.querySelector('.needs-city-message')?.textContent).toBe(content);
  });

  it('clears phase timeouts on reduced-motion changes and unmount without changing the current location', () => {
    const schedule = createTimeoutSpy();
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    const view = render(<HeroSection />);
    advanceToNextLocation();
    advance(1400);
    const currentMessage = view.container.querySelector('.needs-city-message')!.textContent;
    const beforeReducedMotion = phaseTimerHandles(schedule);
    state.reducedMotion = true;
    view.rerender(<HeroSection />);
    expect(clear).toHaveBeenCalledWith(beforeReducedMotion.at(-1));
    expect(phaseTimerHandles(schedule)).toHaveLength(beforeReducedMotion.length);
    expect(view.container.querySelector('.needs-city-message')!.textContent).toBe(currentMessage);
    advance(18_000);
    expect(view.container.querySelector('.needs-city-message')!.textContent).toBe(currentMessage);
    state.reducedMotion = false;
    view.rerender(<HeroSection />);
    const resumed = phaseTimerHandles(schedule);
    expect(resumed).toHaveLength(beforeReducedMotion.length + 1);
    view.unmount();
    expect(clear).toHaveBeenCalledWith(resumed.at(-1));
  });

  it('freezes typing and message phases while hidden, then resumes after visibility returns', () => {
    const view = render(<HeroSection />);
    const example = () => view.container.querySelector('.needs-city-example[data-phase]');
    advance(500);
    setDocumentHidden(true);
    advance(18_000);
    expect(example()).toHaveAttribute('data-phase', 'typing');
    setDocumentHidden(false);
    advance(1399);
    expect(example()).toHaveAttribute('data-phase', 'typing');
    advance(1);
    expect(example()).toHaveAttribute('data-phase', 'message');
    const message = view.container.querySelector('.needs-city-message')!.textContent;
    advance(500);
    setDocumentHidden(true);
    advance(18_000);
    expect(example()).toHaveAttribute('data-phase', 'message');
    expect(view.container.querySelector('.needs-city-message')!.textContent).toBe(message);
    setDocumentHidden(false);
    advance(3599);
    expect(example()).toHaveAttribute('data-phase', 'message');
    advance(1);
    expect(example()).toHaveAttribute('data-phase', 'leaving');
  });
});

function advance(milliseconds: number) {
  // Flush each phase separately so its effect schedules the following phase.
  act(() => { vi.advanceTimersByTime(milliseconds); });
}

function advanceToNextLocation() {
  advance(1400);
  advance(3600);
  advance(280);
  advance(180);
}

function setDocumentHidden(hidden: boolean) {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(hidden);
  fireEvent(document, new Event('visibilitychange'));
}

function createTimeoutSpy() {
  return vi.spyOn(globalThis, 'setTimeout');
}

function phaseTimerHandles(schedule: ReturnType<typeof createTimeoutSpy>) {
  return schedule.mock.calls.flatMap(([, delay], index) =>
    [1400, 3600, 280, 180].includes(Number(delay)) ? [schedule.mock.results[index].value] : []);
}
