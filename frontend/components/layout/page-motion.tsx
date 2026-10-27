'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

/** A navigation cue without remounting pages, delaying routing, or hiding SSR content. */
export function PageMotion({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const previousPath = useRef(pathname);
  const main = useRef<HTMLElement>(null);

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;

    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (preference.matches || !main.current?.animate) return;

    const animation = main.current.animate(
      [{ opacity: 0.65 }, { opacity: 1 }],
      { duration: 180, easing: 'ease-out' },
    );
    const stop = () => animation.cancel();
    preference.addEventListener('change', stop);
    return () => {
      stop();
      preference.removeEventListener('change', stop);
    };
  }, [pathname]);

  return <main ref={main} id="main-content" tabIndex={-1} className="relative flex-grow">{children}</main>;
}
