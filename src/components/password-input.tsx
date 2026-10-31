'use client';

import { useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/**
 * Input password dengan tombol mata untuk menampilkan/menyembunyikan teks.
 *
 * Kenapa komponen tersendiri: tombol mata dipakai di beberapa form (login,
 * tambah staff, edit akun). Tanpa komponen bersama, logika yang sama akan
 * ditulis ulang di tiap form — sumber bug kalau salah satu lupa diperbarui.
 *
 * Aksesibilitas: tombol punya `aria-label` yang menjelaskan aksinya, dan
 * `type="button"` agar tidak memicu submit form induknya.
 */
export function PasswordInput({
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  const [tampak, setTampak] = useState(false);

  return (
    <div style={{ position: 'relative' }}>
      <input
        {...props}
        type={tampak ? 'text' : 'password'}
        // Padding kanan lega agar teks tidak tertutup tombol mata.
        style={{ ...props.style, paddingRight: 40 }}
      />
      <button
        type="button"
        aria-label={tampak ? 'Sembunyikan password' : 'Tampilkan password'}
        aria-pressed={tampak}
        title={tampak ? 'Sembunyikan password' : 'Tampilkan password'}
        style={{
          position: 'absolute',
          right: 8,
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--on-surface-muted, #666)',
          padding: 4,
          lineHeight: 0,
        }}
        onClick={() => setTampak((v) => !v)}
      >
        {tampak ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
      </button>
    </div>
  );
}
