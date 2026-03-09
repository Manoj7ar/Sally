import { useEffect, useRef } from 'react';

export function useScrollReveal<T extends HTMLElement>(delay?: number) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            if (delay !== undefined) {
              el.style.transitionDelay = `${delay}ms`;
            }
            el.classList.add('revealed');
            observer.unobserve(el);
          }
        });
      },
      { threshold: 0.15 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [delay]);

  return ref;
}
