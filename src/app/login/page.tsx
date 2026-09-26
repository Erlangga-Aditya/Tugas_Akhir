'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PackageCheck, LogIn } from 'lucide-react';
import { api } from '@/lib/api';

interface TenantOption { id: string; name: string; role: string }

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api('/api/v1/auth/login', { method: 'POST', body: { email, password, tenantId: tenantId || undefined } });
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      const e = err as { code?: string; details?: Record<string, unknown> };
      if (e.code === 'CONFLICT' && e.details?.tenants) {
        setTenants(e.details.tenants as TenantOption[]);
      } else {
        setError((err as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <span style={{ display: 'inline-flex', width: 44, height: 44, alignItems: 'center', justifyContent: 'center', background: 'var(--primary)', color: '#fff', borderRadius: 'var(--r-lg)' }}>
            <PackageCheck size={22} aria-hidden />
          </span>
          <h1 style={{ fontSize: 22, marginTop: 12 }}>E-Fulfill Hub</h1>
          <p className="muted" style={{ marginTop: 4 }}>Masuk ke workspace Anda</p>
        </div>

        <div className="card">
          {tenants.length > 0 ? (
            <div>
              <h2 style={{ fontSize: 15, marginBottom: 4 }}>Pilih Toko</h2>
              <p className="muted small" style={{ marginBottom: 12 }}>Akun Anda terdaftar di beberapa toko. Pilih yang ingin dimasuki.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {tenants.map((t) => (
                  <button key={t.id} className="btn btn-secondary" style={{ justifyContent: 'flex-start' }}
                    onClick={() => { setTenantId(t.id); setTenants([]); }}>
                    <span className="grow" style={{ textAlign: 'left' }}>{t.name}</span>
                    <span className="badge badge-neutral">{t.role}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" type="email" className="input" placeholder="nama@email.com"
                  value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
              </div>
              <div className="field">
                <label htmlFor="password">Password</label>
                <input id="password" type="password" className="input" placeholder="••••••••"
                  value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
              </div>
              {error ? <div className="alert alert-danger mb16">{error}</div> : null}
              <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%' }}>
                {loading ? <div className="spinner" style={{ borderTopColor: '#fff' }} /> : <LogIn size={16} aria-hidden />}
                {loading ? 'Memproses...' : 'Masuk'}
              </button>
            </form>
          )}
        </div>

        <p className="muted" style={{ textAlign: 'center', marginTop: 16, fontSize: 13 }}>
          Belum punya akun? <Link href="/register">Daftar sekarang</Link>
        </p>
      </div>
    </div>
  );
}
