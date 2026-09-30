'use client';

import { useEffect } from 'react';

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  void navigator.serviceWorker.register('/sw.js', {
    scope: '/',
    updateViaCache: 'none',
  }).catch(() => {
    // PWA adalah peningkatanopsional; kegagalan registrasi tidak boleh memblokir aplikasi.
  });
}

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    registerServiceWorker();
  }, []);
  return null;
}
