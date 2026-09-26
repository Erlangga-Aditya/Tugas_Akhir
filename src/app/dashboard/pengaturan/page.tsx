'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Store,  ShieldCheck, UserCheck, RefreshCw,
  Plus, Pencil, Trash2, X, Check, Users, Building2,
  Eye, EyeOff, ChevronRight,
} from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, StatusBadge, LoadingState, ErrorState, Alert, Modal } from '@/components/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Me {
  user: { id: string; name: string; email: string } | null;
  tenantId: string;
  tenantName: string | null;
  role: string | null;
}

interface WarehouseData {
  id: string;
  name: string;
  code: string;
  status: string;
}

interface ShopData {
  id: string;
  provider: string;
  name: string;
  externalShopId: string | null;
  status: string;
}

interface UserMember {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  joinedAt: string;
}

// ─── Tab component ────────────────────────────────────────────────────────────

function Tab({
  label,
  active,
  icon,
  onClick,
}: {
  label: string;
  active: boolean;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 16px',
        border: 'none',
        background: active ? 'var(--primary)' : 'transparent',
        color: active ? '#fff' : 'var(--on-surface-muted)',
        borderRadius: 8,
        fontWeight: active ? 700 : 500,
        fontSize: 14,
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// ─── Warehouse Management Section ─────────────────────────────────────────────

function WarehouseSection() {
  const [warehouses, setWarehouses] = useState<WarehouseData[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', code: '' });
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<WarehouseData[]>('/api/v1/warehouses');
      setWarehouses(data);
    } catch (e) {
      setNotice({ tone: 'danger', text: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Ditunda satu task: pemuatan data dipicu setelah render selesai, bukan di tengah effect.
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function createWarehouse(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    setSaving(true);
    try {
      await api('/api/v1/warehouses', { method: 'POST', body: form });
      setNotice({ tone: 'success', text: `Gudang "${form.name}" berhasil ditambahkan.` });
      setForm({ name: '', code: '' });
      setShowForm(false);
      await load();
    } catch (err) {
      setNotice({ tone: 'danger', text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function updateWarehouse(id: string) {
    setNotice(null);
    try {
      await api(`/api/v1/warehouses/${id}`, { method: 'PATCH', body: { name: editName } });
      setEditId(null);
      setNotice({ tone: 'success', text: 'Gudang berhasil diperbarui.' });
      await load();
    } catch (err) {
      setNotice({ tone: 'danger', text: (err as Error).message });
    }
  }

  async function toggleStatus(w: WarehouseData) {
    setNotice(null);
    try {
      await api(`/api/v1/warehouses/${w.id}`, {
        method: 'PATCH',
        body: { status: w.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' },
      });
      await load();
    } catch (err) {
      setNotice({ tone: 'danger', text: (err as Error).message });
    }
  }

  return (
    <div>
      {notice && <div className="mb12"><Alert tone={notice.tone}>{notice.text}</Alert></div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Building2 size={16} style={{ color: 'var(--primary)' }} aria-hidden />
          Gudang Fisik
        </h2>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => setShowForm(!showForm)}
        >
          <Plus size={14} aria-hidden />
          <span>Tambah Gudang</span>
        </button>
      </div>

      {showForm && (
        <div className="card mb16" style={{ border: '1px solid var(--primary)', background: 'var(--surface-elevated)' }}>
          <form onSubmit={createWarehouse}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="field">
                <label>Nama Gudang</label>
                <input
                  type="text"
                  className="input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  placeholder="Contoh: Gudang Jakarta Pusat"
                />
              </div>
              <div className="field">
                <label>Kode Gudang (unik, huruf kapital)</label>
                <input
                  type="text"
                  className="input mono"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  required
                  maxLength={20}
                  placeholder="Contoh: WH-JKT-01"
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                {saving ? 'Menyimpan...' : 'Simpan Gudang'}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)}>Batal</button>
            </div>
          </form>
        </div>
      )}

      {loading ? <LoadingState message="Memuat gudang..." /> : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Kode</th>
                <th>Nama Gudang</th>
                <th>Status</th>
                <th style={{ textAlign: 'center' }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {warehouses.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--on-surface-muted)', padding: 24 }}>
                  Belum ada gudang. Tambahkan gudang pertama Anda.
                </td></tr>
              ) : warehouses.map((w) => (
                <tr key={w.id}>
                  <td className="mono" style={{ fontWeight: 700 }}>{w.code}</td>
                  <td>
                    {editId === w.id ? (
                      <input
                        type="text"
                        className="input"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        style={{ maxWidth: 240 }}
                        autoFocus
                      />
                    ) : w.name}
                  </td>
                  <td><StatusBadge status={w.status} /></td>
                  <td>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 6 }}>
                      {editId === w.id ? (
                        <>
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => updateWarehouse(w.id)}>
                            <Check size={12} /><span>Simpan</span>
                          </button>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditId(null)}>
                            <X size={12} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => { setEditId(w.id); setEditName(w.name); }}
                          >
                            <Pencil size={12} /><span>Edit</span>
                          </button>
                          <button
                            type="button"
                            className={`btn btn-sm ${w.status === 'ACTIVE' ? 'btn-ghost' : 'btn-primary'}`}
                            onClick={() => toggleStatus(w)}
                          >
                            {w.status === 'ACTIVE' ? <><EyeOff size={12} /><span>Nonaktifkan</span></> : <><Eye size={12} /><span>Aktifkan</span></>}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── User Management Section ──────────────────────────────────────────────────

function UserManagementSection({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<UserMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [invite, setInvite] = useState({ name: '', email: '', password: '', role: 'STAFF' });
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<string>('STAFF');
  const [deleteConfirm, setDeleteConfirm] = useState<UserMember | null>(null);
  const [showPw, setShowPw] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ items: UserMember[] }>('/api/v1/users');
      setUsers(res.items ?? []);
    } catch (e) {
      setNotice({ tone: 'danger', text: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Ditunda satu task: pemuatan data dipicu setelah render selesai, bukan di tengah effect.
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function inviteUser(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    setSaving(true);
    try {
      await api('/api/v1/users', { method: 'POST', body: invite });
      setNotice({ tone: 'success', text: `Pengguna "${invite.name}" berhasil ditambahkan.` });
      setInvite({ name: '', email: '', password: '', role: 'OPERATOR' });
      setShowInvite(false);
      await load();
    } catch (err) {
      setNotice({ tone: 'danger', text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function updateUserRole(userId: string) {
    setNotice(null);
    try {
      await api(`/api/v1/users/${userId}`, { method: 'PATCH', body: { role: editRole } });
      setEditId(null);
      setNotice({ tone: 'success', text: 'Hak akses pengguna berhasil diperbarui.' });
      await load();
    } catch (err) {
      setNotice({ tone: 'danger', text: (err as Error).message });
    }
  }

  async function removeUser(userId: string) {
    setNotice(null);
    try {
      await api(`/api/v1/users/${userId}`, { method: 'DELETE' });
      setDeleteConfirm(null);
      setNotice({ tone: 'success', text: 'Pengguna berhasil dihapus dari workspace.' });
      await load();
    } catch (err) {
      setNotice({ tone: 'danger', text: (err as Error).message });
      setDeleteConfirm(null);
    }
  }

  const roleBadgeClass: Record<string, string> = {
    OWNER: 'badge-danger',
    MANAGER: 'badge-primary',
    FINANCE: 'badge-warning',
    STAFF: 'badge-neutral',
  };

  return (
    <div>
      {notice && <div className="mb12"><Alert tone={notice.tone}>{notice.text}</Alert></div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Users size={16} style={{ color: 'var(--secondary)' }} aria-hidden />
          Manajemen Pengguna
        </h2>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowInvite(!showInvite)}>
          <Plus size={14} aria-hidden />
          <span>Tambah Pengguna</span>
        </button>
      </div>

      {showInvite && (
        <div className="card mb16" style={{ border: '1px solid var(--secondary)' }}>
          <form onSubmit={inviteUser}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="field">
                <label>Nama Lengkap</label>
                <input type="text" className="input" value={invite.name}
                  onChange={(e) => setInvite({ ...invite, name: e.target.value })} required placeholder="Nama pengguna" />
              </div>
              <div className="field">
                <label>Alamat Email</label>
                <input type="email" className="input" value={invite.email}
                  onChange={(e) => setInvite({ ...invite, email: e.target.value })} required placeholder="email@contoh.com" />
              </div>
              <div className="field">
                <label>Password</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPw ? 'text' : 'password'}
                    className="input"
                    value={invite.password}
                    onChange={(e) => setInvite({ ...invite, password: e.target.value })}
                    required minLength={8}
                    placeholder="Minimal 8 karakter"
                  />
                  <button
                    type="button"
                    style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--on-surface-muted)' }}
                    onClick={() => setShowPw(!showPw)}
                  >
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div className="field">
                <label>Hak Akses</label>
                <select className="input" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
                  <option value="OWNER">Owner — Pemilik, akses penuh</option>
                  <option value="MANAGER">Manager — Kelola semua operasi</option>
                  <option value="FINANCE">Finance — Akses laporan keuangan</option>
                  <option value="STAFF">Staff — Operasional harian (default)</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                {saving ? 'Menyimpan...' : 'Tambah Pengguna'}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowInvite(false)}>Batal</button>
            </div>
          </form>
        </div>
      )}

      {loading ? <LoadingState message="Memuat pengguna..." /> : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Nama</th>
                <th>Email</th>
                <th>Hak Akses</th>
                <th style={{ textAlign: 'center' }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.membershipId}>
                  <td style={{ fontWeight: 600 }}>
                    {u.name}
                    {u.userId === currentUserId && (
                      <span className="badge badge-primary" style={{ marginLeft: 6, fontSize: 10 }}>Anda</span>
                    )}
                  </td>
                  <td className="small">{u.email}</td>
                  <td>
                    {editId === u.userId ? (
                      <select
                        className="input"
                        value={editRole}
                        onChange={(e) => setEditRole(e.target.value)}
                        style={{ width: 'auto' }}
                      >
                        <option value="OWNER">OWNER</option>
                        <option value="MANAGER">MANAGER</option>
                        <option value="FINANCE">FINANCE</option>
                        <option value="STAFF">STAFF</option>
                      </select>
                    ) : (
                      <span className={`badge ${roleBadgeClass[u.role] ?? 'badge-neutral'}`}>{u.role}</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 6 }}>
                      {editId === u.userId ? (
                        <>
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => updateUserRole(u.userId)}>
                            <Check size={12} /><span>Simpan</span>
                          </button>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditId(null)}>
                            <X size={12} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => { setEditId(u.userId); setEditRole(u.role); }}
                          >
                            <Pencil size={12} /><span>Edit Akses</span>
                          </button>
                          {u.userId !== currentUserId && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              style={{ color: 'var(--danger)' }}
                              onClick={() => setDeleteConfirm(u)}
                            >
                              <Trash2 size={12} /><span>Hapus</span>
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirm && (
        <Modal isOpen title="Konfirmasi Hapus Pengguna" onClose={() => setDeleteConfirm(null)}>
          <p className="mb16">
            Apakah Anda yakin ingin menghapus <strong>{deleteConfirm.name}</strong> ({deleteConfirm.email}) dari workspace?
            Akun mereka tidak dihapus secara permanen.
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn btn-danger grow" onClick={() => removeUser(deleteConfirm.userId)}>
              <Trash2 size={14} aria-hidden />
              <span>Ya, Hapus dari Workspace</span>
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>Batal</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type ActiveTab = 'profil' | 'gudang' | 'pengguna' | 'toko';

export default function PengaturanPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [shops, setShops] = useState<ShopData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<ActiveTab>('profil');

  const load = useCallback(() => {
    Promise.all([
      api<Me>('/api/v1/auth/me'),
      api<ShopData[]>('/api/v1/shops'),
    ])
      .then(([m, s]) => {
        setMe(m);
        setShops(s);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  if (loading) return <LoadingState message="Memuat pengaturan workspace..." />;
  if (error) return <ErrorState message={error} onRetry={() => { setLoading(true); setError(''); load(); }} />;

  return (
    <div>
      <PageHeader
        title="Pengaturan & Profil Workspace"
        subtitle="Kelola profil tenant, gudang fisik, pengguna, dan saluran marketplace"
        actions={
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setLoading(true); setError(''); load(); }}>
            <RefreshCw size={14} aria-hidden />
            <span>Muat Ulang</span>
          </button>
        }
      />

      {/* Tabs */}
      <div style={{
        display: 'flex',
        gap: 6,
        marginBottom: 24,
        background: 'var(--surface)',
        padding: 6,
        borderRadius: 12,
        border: '1px solid var(--divider)',
        flexWrap: 'wrap',
      }}>
        <Tab label="Profil Workspace" icon={<UserCheck size={15} aria-hidden />} active={activeTab === 'profil'} onClick={() => setActiveTab('profil')} />
        <Tab label="Gudang" icon={<Building2 size={15} aria-hidden />} active={activeTab === 'gudang'} onClick={() => setActiveTab('gudang')} />
        <Tab label="Pengguna" icon={<Users size={15} aria-hidden />} active={activeTab === 'pengguna'} onClick={() => setActiveTab('pengguna')} />
        <Tab label="Toko & Channel" icon={<Store size={15} aria-hidden />} active={activeTab === 'toko'} onClick={() => setActiveTab('toko')} />
      </div>

      {/* ── Tab: Profil ─────────────────────────────────────────────── */}
      {activeTab === 'profil' && (
        <div>
          <div className="card mb24">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--on-surface)' }}>
                  {me?.tenantName ?? 'Workspace Utama'}
                </div>
                <div className="small muted mt8">
                  Akun Pengguna: <strong>{me?.user?.name}</strong> ({me?.user?.email})
                </div>
              </div>
              {me?.role ? (
                <span className="badge badge-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', fontSize: 13 }}>
                  <UserCheck size={14} aria-hidden />
                  <span>Hak Akses: {me.role}</span>
                </span>
              ) : null}
            </div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <ShieldCheck size={18} style={{ color: 'var(--success)' }} aria-hidden />
              <h2 style={{ fontSize: 15, fontWeight: 700 }}>Standar Keamanan & Perlindungan Data</h2>
            </div>
            <p className="small muted" style={{ lineHeight: 1.7 }}>
              Sistem ini menerapkan autentikasi sesi berbasis cookie <code className="mono">httpOnly</code> (anti-XSS),
              isolasi data multi-tenant di setiap query database, serta enkripsi token{' '}
              <code className="mono">AES-256-GCM</code> at rest.
              Setiap webhook dan sinkronisasi pesanan dilengkapi verifikasi tanda tangan HMAC-SHA256 yang idempoten.
              Password di-hash menggunakan <code className="mono">bcrypt</code> dengan cost factor 12.
            </p>
          </div>
        </div>
      )}

      {/* ── Tab: Gudang ─────────────────────────────────────────────── */}
      {activeTab === 'gudang' && (
        <div className="card">
          <WarehouseSection />
        </div>
      )}

      {/* ── Tab: Pengguna ───────────────────────────────────────────── */}
      {activeTab === 'pengguna' && (
        <div className="card">
          <UserManagementSection currentUserId={me?.user?.id ?? ''} />
        </div>
      )}

      {/* ── Tab: Toko & Channel ─────────────────────────────────────── */}
      {activeTab === 'toko' && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <Store size={18} style={{ color: 'var(--secondary)' }} aria-hidden />
            <h2 style={{ fontSize: 15, fontWeight: 700 }}>Saluran Marketplace</h2>
          </div>
          {shops.length === 0 ? (
            <p className="muted small">Belum ada toko yang terhubung. Hubungkan via menu Integrasi Shopee.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Nama Toko</th>
                    <th>Platform</th>
                    <th>Shop ID</th>
                    <th style={{ textAlign: 'right' }}>Status</th>
                    <th style={{ textAlign: 'center' }}>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {shops.map((s) => (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 600 }}>{s.name}</td>
                      <td>
                        <span className="badge badge-primary">{s.provider.toUpperCase()}</span>
                      </td>
                      <td className="mono small">{s.externalShopId ?? '—'}</td>
                      <td style={{ textAlign: 'right' }}><StatusBadge status={s.status} /></td>
                      <td style={{ textAlign: 'center' }}>
                        <a href="/dashboard/integrasi" className="btn btn-secondary btn-sm">
                          <ChevronRight size={12} aria-hidden />
                          <span>Kelola Integrasi</span>
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="small muted mt16">
            Untuk menambah toko, menghubungkan OAuth, sinkronisasi produk/pesanan, dan pengaturan webhook,
            gunakan menu <a href="/dashboard/integrasi" style={{ color: 'var(--primary)' }}>Integrasi Shopee</a>.
          </p>
        </div>
      )}
    </div>
  );
}
