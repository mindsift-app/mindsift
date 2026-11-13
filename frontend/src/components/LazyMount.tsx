import React, { useEffect, useRef, useState } from 'react';

interface LazyMountProps {
  children: React.ReactNode;
  // Shown until the place scrolls into view (keeps the page's height roughly right)
  placeholder: React.ReactNode;
}

// Renders its children only once they come near the visible area, and keeps them afterwards. For lists
// of heavier parts, e.g. one live note editor per entry on a hashtag page.
export const LazyMount: React.FC<LazyMountProps> = ({ children, placeholder }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (shown || !el) return;
    if (typeof IntersectionObserver === 'undefined') {
      // Without IntersectionObserver the content is shown right away
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setShown(true);
      },
      { rootMargin: '400px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [shown]);
  return <div ref={ref}>{shown ? children : placeholder}</div>;
};
