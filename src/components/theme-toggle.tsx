'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';

/**
 * Pilihan tema: terang, gelap, atau mengikuti setelan perangkat.
 *
 * Nilai disimpan di `localStorage` dan diterapkan sebagai atribut
 * `data-theme` pada <html>. Seluruh warna aplikasi berasal dari token CSS,
 * jadi tidak ada komponen yang perlu tahu tema mana yang sedang aktif.
 *
 * Skrip kecil di `app/layout.tsx` menerapkan tema SEBELUM halaman digambar,
 * supaya tidak ada kedipan putih saat membuka aplikasi dalam mode gelap.
 */
export type ThemeChoice = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'efulfill-theme';

const OPTIONS: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Terang', icon: Sun },
  { value: 'dark', label: 'Gelap', icon: Moon },
  { value: 'system', label: 'Ikut perangkat', icon: Monitor },
];

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(choice: ThemeChoice) {
  const dark = choice === 'dark' || (choice === 'system' && systemPrefersDark());
  const root = document.documentElement;
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
  root.style.colorScheme = dark ? 'dark' : 'light';
}

function readStored(): ThemeChoice {
  if (typeof window === 'undefined') return 'system';
  const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
}

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>('system');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Baca pilihan tersimpan setelah mount (server tidak punya localStorage) dan
  // ikuti perubahan setelan perangkat selama pilihan masih "system".
  useEffect(() => {
    const stored = readStored();
    queueMicrotask(() => setChoice(stored));

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (readStored() === 'system') applyTheme('system');
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pilih = (value: ThemeChoice) => {
    setChoice(value);
    setOpen(false);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, value);
    } catch {
      // Mode penyamaran/privat bisa menolak localStorage — tema tetap berlaku
      // untuk sesi ini, hanya tidak diingat setelah tab ditutup.
    }
    applyTheme(value);
  };

  const ActiveIcon = OPTIONS.find((o) => o.value === choice)?.icon ?? Monitor;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Ubah tema tampilan"
        aria-expanded={open}
        title={`Tema: ${OPTIONS.find((o) => o.value === choice)?.label ?? 'Ikut perangkat'}`}
        style={{ padding: '6px 8px' }}
      >
        <ActiveIcon size={17} aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Pilih tema"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 6px)',
            minWidth: 176,
            maxWidth: 'calc(100vw - 24px)',
            padding: 6,
            borderRadius: 10,
            background: 'var(--surface-elevated)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--e-lg)',
            zIndex: 60,
          }}
        >
          {OPTIONS.map((option) => {
            const Icon = option.icon;
            const active = option.value === choice;
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => pilih(option.value)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '7px 8px',
                  borderRadius: 7,
                  border: 'none',
                  background: active ? 'var(--surface-low)' : 'transparent',
                  color: 'var(--on-surface)',
                  fontSize: 13,
                  fontWeight: active ? 700 : 500,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <Icon size={15} aria-hidden />
                <span style={{ flex: 1 }}>{option.label}</span>
                {active ? <Check size={14} aria-hidden style={{ color: 'var(--success)' }} /> : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
