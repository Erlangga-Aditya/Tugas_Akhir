'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PackageCheck, UserPlus } from 'lucide-react';
import { api } from '@/lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '', tenantName: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function update(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((p) => ({ ...p, [e.target.name]: e.target.value }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api('/api/v1/auth/register', { method: 'POST', body: form });
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <span style={{ display: 'inline-flex', width: 44, height: 44, alignItems: 'center', justifyContent: 'center', background: 'var(--primary)', color: '#fff', borderRadius: 'var(--r-lg)' }}>
            <PackageCheck size={22} aria-hidden />
          </span>
          <h1 style={{ fontSize: 22, marginTop: 12 }}>E-Fulfill Hub</h1>
          <p className="muted" style={{ marginTop: 4 }}>Buat akun dan mulai kelola fulfillment</p>
        </div>

        <div className="card">
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="field">
              <label htmlFor="name">Nama Lengkap</label>
              <input id="name" name="name" className="input" placeholder="Nama Anda" value={form.name} onChange={update} required />
            </div>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" name="email" type="email" className="input" placeholder="nama@email.com" value={form.email} onChange={update} required />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input id="password" name="password" type="password" className="input" placeholder="Min. 8 karakter, huruf besar + angka" value={form.password} onChange={update} required />
            </div>
            <div className="field">
              <label htmlFor="tenantName">Nama Toko / Bisnis</label>
              <input id="tenantName" name="tenantName" className="input" placeholder="Nama toko Anda" value={form.tenantName} onChange={update} required />
              <p className="muted small">Ini menjadi identitas tenant Anda.</p>
            </div>
            {error ? <div className="alert alert-danger mb16">{error}</div> : null}
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%' }}>
              {loading ? <div className="spinner" style={{ borderTopColor: '#fff' }} /> : <UserPlus size={16} aria-hidden />}
              {loading ? 'Mendaftarkan...' : 'Daftar'}
            </button>
          </form>
        </div>

        <p className="muted" style={{ textAlign: 'center', marginTop: 16, fontSize: 13 }}>
          Sudah punya akun? <Link href="/login">Masuk di sini</Link>
        </p>
      </div>
    </div>
  );
}
