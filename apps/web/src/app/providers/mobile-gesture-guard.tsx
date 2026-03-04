'use client';

import { useEffect } from 'react';

export function MobileGestureGuard() {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const platform = navigator.userAgent || navigator.vendor || '';
    const isAppleMobile = /iPhone|iPad|iPod/i.test(platform);

    if (!isAppleMobile) {
      return undefined;
    }

    let lastTouchEnd = 0;

    const preventGesture = (event: Event) => {
      event.preventDefault();
    };

    const preventPinch = (event: TouchEvent) => {
      if (event.touches.length > 1) {
        event.preventDefault();
      }
    };

    const preventDoubleTapZoom = (event: TouchEvent) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) {
        event.preventDefault();
      }
      lastTouchEnd = now;
    };

    document.addEventListener('gesturestart', preventGesture, { passive: false });
    document.addEventListener('gesturechange', preventGesture, { passive: false });
    document.addEventListener('gestureend', preventGesture, { passive: false });
    document.addEventListener('touchmove', preventPinch, { passive: false });
    document.addEventListener('touchend', preventDoubleTapZoom, { passive: false });

    return () => {
      document.removeEventListener('gesturestart', preventGesture);
      document.removeEventListener('gesturechange', preventGesture);
      document.removeEventListener('gestureend', preventGesture);
      document.removeEventListener('touchmove', preventPinch);
      document.removeEventListener('touchend', preventDoubleTapZoom);
    };
  }, []);

  return null;
}
