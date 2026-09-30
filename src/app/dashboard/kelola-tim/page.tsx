'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { UserPlus, ShieldCheck, Power, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';

/**
 * Kelola Tim — tempat owner mengatur siapa yang boleh masuk dan apa yang boleh
 * mereka lakukan.
 *
 * Prinsip yang dipakai supaya mudah dibaca owner:
 *  - Satu daftar izin, dikelompokkan "Halaman" (boleh lihat) dan "Aksi"
 *    (boleh kerjakan). Tidak ada role tambahan yang harus dipelajari.
 *  - Preset untuk kasus umum. Owner tidak wajib centang satu per satu.
 *  - Perubahan langsung tersimpan, jadi tidak ada tombol "Simpan" yang
 *   _pending diam-diam.
 *  - Setiap perubahan dicatat di riwayat audit aplikasi.
 */

interface PermissionMeta {
  key: string;
  label: string;
  group: 'Halaman' | 'Aksi';
}

interface Member {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: 'OWNER' | 'STAFF';
  isOwner: boolean;
  permissions: string[];
  status?: string;
  joinedAt: string;
}

interface UsersResponse {
  items: Member[];
  catalog: PermissionMeta[];
  defaultPermissions: string[];
}

/**
 * Preset. Dipakai sebagai titik awal, lalu owner bebas mencentang ulang.
 * `granted` ditulis berisi nilai AWAL yang sudah di-toggle agar owner bisa
 * melihat perubahannya sebelum menekan tombol.
 */
const PRESETS: { id: string; name: string; description: string; granted: string[] }[] = [
  {
    id: 'gudang',
    name: 'Gudang (operasional harian)',
    description: 'Melihat dan mengerjakan pesanan, stok, dan kirim. Tidak menyentuh keuangan atau pengaturan.',
    granted: [
      'page.dashboard', 'page.orders', 'page.inventory', 'page.products', 'page.shipping',
      'order.prepare_shipment', 'order.pick', 'order.pack', 'order.handover', 'inventory.receive',
    ],
  },
  {
    id: 'lapor',
    name: 'Lapor saja (baca tanpa mengubah)',
    description: 'Bisa melihat semua halaman termasuk keuangan, tapi tidak boleh mengubah apa pun.',
    granted: [
      'page.dashboard', 'page.orders', 'page.inventory', 'page.products', 'page.shipping',
      'page.returns', 'page.reports', 'page.finance',
    ],
  },
  {
    id: 'penuh',
    name: 'Semua hak kecuali kelola tim',
    description: 'Boleh apa pun yang boleh owner, tapi tidak bisa menambah staff atau mengubah izin.',
    granted: [
      'page.dashboard', 'page.orders', 'page.inventory', 'page.products', 'page.shipping',
      'page.returns', 'page.reports', 'page.finance', 'page.integrations', 'page.settings',
      'order.cancel', 'order.prepare_shipment', 'order.pick', 'order.pack', 'order.handover',
      'order.requeue', 'inventory.adjust', 'inventory.receive', 'product.manage',
      'shopee.sync', 'shopee.manage', 'finance.view', 'settings.manage',
    ],
  },
];

const EMPTY: UsersResponse = { items: [], catalog: [], defaultPermissions: [] };

export default function KelolaTimPage() {
  const [data, setData] = useState<UsersResponse>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  // Izin yang sedang disunting (belum tersimpan).
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<UsersResponse>('/api/v1/users?pageSize=50');
      setData(res);
      setDraft(Object.fromEntries(res.items.map((m) => [m.userId, m.permissions])));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // `queueMicrotask` mencegah cascading render: setState langsung di dalam
    // effect synchronously bisa memicu render kedua sebelum paint pertama.
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  const byGroup = useMemo(() => {
    const map = new Map<string, PermissionMeta[]>();
    for (const c of data.catalog) {
      const list = map.get(c.group) ?? [];
      list.push(c);
      map.set(c.group, list);
    }
    return [...map.entries()];
  }, [data.catalog]);

  async function savePermissions(member: Member) {
    const next = draft[member.userId] ?? [];
    setSavingId(member.userId);
    setError(null);
    try {
      await api(`/api/v1/users/${member.userId}`, {
        method: 'PATCH',
        body: { permissions: next },
      });
      setNotice(`Hak akses ${member.name} disimpan.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  async function setStatus(member: Member, status: 'ACTIVE' | 'INACTIVE') {
    setSavingId(member.userId);
    setError(null);
    try {
      await api(`/api/v1/users/${member.userId}`, { method: 'PATCH', body: { status } });
      setNotice(status === 'ACTIVE' ? `${member.name} diaktifkan.` : `${member.name} dinonaktifkan.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  async function removeMember(member: Member) {
    if (!window.confirm(`Cabut akses ${member.name}? Akunnya tidak dihapus, dan bisa diaktifkan lagi.`)) return;
    setSavingId(member.userId);
    setError(null);
    try {
      await api(`/api/v1/users/${member.userId}`, { method: 'DELETE' });
      setNotice(`Akses ${member.name} dicabut.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  const toggle = (userId: string, key: string) =>
    setDraft((prev) => {
      const current = prev[userId] ?? [];
      return {
        ...prev,
        [userId]: current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
      };
    });

  const toggleGroup = (userId: string, group: string, keys: string[]) => {
    const current = draft[userId] ?? [];
    const allOn = keys.every((k) => current.includes(k));
    setDraft((prev) => ({
      ...prev,
      [userId]: allOn
        ? current.filter((k) => !keys.includes(k))
        : [...new Set([...current, ...keys])],
    }));
  };

  if (loading) return <p className="muted">Memuat data tim…</p>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Kelola Tim</h1>
          <p className="muted">
            Tambah akun staff, lalu tentukan halaman yang boleh dilihat dan aksi yang boleh
            dilakukan. Perubahan berlaku saat staff membuka ulang halamannya.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
          <UserPlus size={16} aria-hidden /> Tambah Staff
        </button>
      </div>

      {error ? <div className="alert alert-danger">{error}</div> : null}
      {notice ? <div className="alert alert-success">{notice}</div> : null}

      {showForm ? <InviteForm onDone={() => { setShowForm(false); void load(); }} catalog={data.catalog} defaultPermissions={data.defaultPermissions} /> : null}

      <div className="card" style={{ marginTop: 16 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Nama</th>
              <th>Peran</th>
              <th>Status</th>
              <th>Hak akses</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.items.map((m) => {
              const current = draft[m.userId] ?? [];
              const active = m.status !== 'INACTIVE';
              return (
                <tr key={m.userId}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{m.name}</div>
                    <div className="muted small">{m.email}</div>
                  </td>
                  <td>
                    <span className="badge badge-secondary">{m.role === 'OWNER' ? 'Owner' : 'Staff'}</span>
                  </td>
                  <td>
                    <span className={`badge ${active ? 'badge-success' : 'badge-secondary'}`}>
                      {active ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </td>
                  <td>
                    {m.isOwner ? (
                      <span className="muted small">Semua halaman &amp; aksi (owner)</span>
                    ) : (
                      <span className="muted small">{current.length} dari {data.catalog.length} izin</span>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {!m.isOwner ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => setOpenId(openId === m.userId ? null : m.userId)}
                        >
                          <ShieldCheck size={16} aria-hidden /> Atur Izin
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={savingId === m.userId}
                          onClick={() => void setStatus(m, active ? 'INACTIVE' : 'ACTIVE')}
                        >
                          <Power size={16} aria-hidden /> {active ? 'Nonaktifkan' : 'Aktifkan'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={savingId === m.userId}
                          onClick={() => void removeMember(m)}
                        >
                          <Trash2 size={16} aria-hidden /> Cabut
                        </button>
                      </>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {openId
        ? data.items
            .filter((m) => m.userId === openId)
            .map((m) => (
              <PermissionEditor
                key={m.userId}
                member={m}
                current={draft[m.userId] ?? []}
                byGroup={byGroup}
                dirty={
                  [...(draft[m.userId] ?? [])].sort().join(',') !==
                  [...m.permissions].sort().join(',')
                }
                saving={savingId === m.userId}
                onToggle={(k) => toggle(m.userId, k)}
                onToggleGroup={(g, keys) => toggleGroup(m.userId, g, keys)}
                onSave={() => void savePermissions(m)}
              />
            ))
        : null}
    </>
  );
}

function PermissionEditor({
  member,
  current,
  byGroup,
  dirty,
  saving,
  onToggle,
  onToggleGroup,
  onSave,
}: {
  member: Member;
  current: string[];
  byGroup: [string, PermissionMeta[]][];
  dirty: boolean;
  saving: boolean;
  onToggle: (k: string) => void;
  onToggleGroup: (g: string, keys: string[]) => void;
  onSave: () => void;
}) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="page-head">
        <div>
          <h2>Hak akses — {member.name}</h2>
          <p className="muted small">Centang yang boleh. Kosongkan berarti tidak boleh sama sekali.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="btn btn-ghost"
              title={p.description}
              onClick={() => onToggleGroup(p.id, p.granted)}
            >
              {p.name}
            </button>
          ))}
          <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={onSave}>
            {saving ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
      </div>

      {byGroup.map(([group, list]) => (
        <fieldset key={group} style={{ border: 'none', padding: 0, margin: '12px 0' }}>
          <legend style={{ fontWeight: 600, marginBottom: 6 }}>
            {group}{' '}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onToggleGroup(group, list.map((c) => c.key))}
            >
              {list.every((c) => current.includes(c.key)) ? 'Hapus semua' : 'Pilih semua'}
            </button>
          </legend>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 6 }}>
            {list.map((c) => (
              <label key={c.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={current.includes(c.key)}
                  onChange={() => onToggle(c.key)}
                  style={{ marginTop: 3 }}
                />
                <span>
                  {c.label}
                  <div className="muted small" style={{ fontFamily: 'monospace' }}>{c.key}</div>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function InviteForm({
  onDone,
  catalog,
  defaultPermissions,
}: {
  onDone: () => void;
  catalog: PermissionMeta[];
  defaultPermissions: string[];
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [permissions, setPermissions] = useState<string[]>(defaultPermissions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/v1/users', { method: 'POST', body: { name, email, password, role: 'STAFF', permissions } });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" style={{ marginTop: 16 }} onSubmit={submit}>
      <h2>Tambah Staff</h2>
      {error ? <div className="alert alert-danger">{error}</div> : null}
      <div style={{ display: 'grid', gap: 8, maxWidth: 420 }}>
        <label>
          Nama
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
        </label>
        <label>
          Email
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password (minimal 8 karakter)
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </label>
        <div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Hak akses awal</div>
          <div className="muted small" style={{ marginBottom: 6 }}>
            Bisa diubah kapan saja. Yang dicentang sekarang berlaku saat akun dibuat.
          </div>
          {catalog.map((c) => (
            <label key={c.key} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
              <input
                type="checkbox"
                checked={permissions.includes(c.key)}
                onChange={() =>
                  setPermissions((prev) =>
                    prev.includes(c.key) ? prev.filter((k) => k !== c.key) : [...prev, c.key],
                  )
                }
              />
              {c.label}
              <span className="muted small" style={{ fontFamily: 'monospace' }}>{c.key}</span>
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Menyimpan…' : 'Buat akun'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onDone}>Batal</button>
        </div>
      </div>
    </form>
  );
}
