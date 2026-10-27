import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PageMotion } from '@/components/layout/page-motion';

const route = vi.hoisted(() => ({ pathname: '/search' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));

const cancel = vi.fn();
const animate = vi.fn(() => ({ cancel }));
let preference: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };

beforeEach(() => {
  route.pathname = '/search';
  vi.clearAllMocks();
  preference = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('matchMedia', vi.fn(() => preference));
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, 'animate');
});

function Draft() {
  const [value, setValue] = useState('');
  return <input aria-label="Draft" value={value} onChange={event => setValue(event.target.value)} />;
}

it('keeps content visible on first load and preserves child state during route feedback', () => {
  const view = render(<PageMotion><Draft /></PageMotion>);
  expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
  expect(animate).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'Unsaved text' } });
  view.rerender(<PageMotion><Draft /></PageMotion>);
  expect(animate).not.toHaveBeenCalled();
  route.pathname = '/items';
  view.rerender(<PageMotion><Draft /></PageMotion>);
  expect(screen.getByLabelText('Draft')).toHaveValue('Unsaved text');
  expect(animate).toHaveBeenCalledTimes(1);
});

it('skips navigation motion when reduced motion is requested', () => {
  preference.matches = true;
  const view = render(<PageMotion>Visible content</PageMotion>);
  route.pathname = '/items';
  view.rerender(<PageMotion>Destination content</PageMotion>);
  expect(screen.getByText('Destination content')).toBeVisible();
  expect(animate).not.toHaveBeenCalled();
});

it('cancels feedback on rapid navigation and when motion preference changes', () => {
  const view = render(<PageMotion>Search</PageMotion>);
  route.pathname = '/items';
  view.rerender(<PageMotion>Items</PageMotion>);
  const onPreferenceChange = preference.addEventListener.mock.calls[0][1];
  onPreferenceChange();
  expect(cancel).toHaveBeenCalledTimes(1);
  route.pathname = '/services';
  view.rerender(<PageMotion>Services</PageMotion>);
  expect(cancel).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Services')).toBeVisible();
});
