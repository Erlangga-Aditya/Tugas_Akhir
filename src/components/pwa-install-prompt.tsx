'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const isIos = () =>
  typeof navigator !== 'undefined' &&
  /iPad|iPhone|iPod/.test(navigator.userAgent) &&
  !('MSStream' in window);

const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);

export function PwaInstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios] = useState(() => isIos());
  const [installed, setInstalled] = useState(() => isStandalone());
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed || dismissed || (!promptEvent && !ios)) return null;

  async function install() {
    if (!promptEvent) return;
    setBusy(true);
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === 'accepted') setInstalled(true);
      else setDismissed(true);
    } finally {
      setPromptEvent(null);
      setBusy(false);
    }
  }

  return (
    <div className="pwa-install-banner" role="status">
      <div>
        <strong>Pasang aplikasi di layar utama</strong>
        <p>
          {ios
            ? 'Di iPhone: tekan Bagikan, lalu pilih Tambahkan ke Layar Utama.'
            : 'Buka aplikasi lebih cepat dan akses kamera tanpa membuka menu browser.'}
        </p>
      </div>
      <div className="pwa-install-actions">
        {promptEvent ? (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void install()} disabled={busy}>
            <Download size={14} aria-hidden />
            <span>{busy ? 'Menyiapkan...' : 'Pasang aplikasi'}</span>
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-label="Tutup panduan pasang aplikasi"
          onClick={() => setDismissed(true)}
        >
          <X size={14} aria-hidden />
        </button>
      </div>
    </div>
  );
}
