'use client';

import { useCallback, useEffect, useState, useMemo } from 'react';
import { RefreshCw, Search, BookOpen, Layers } from 'lucide-react';
import { api, formatDate } from '@/lib/api';
import { PageHeader, StatusBadge, LoadingState, ErrorState, EmptyState } from '@/components/ui';

interface Movement {
  id: string;
  movementType: string;
  quantityDelta: number;
  sku: string;
  variantName: string;
  warehouseName: string;
  reason: string | null;
  actorName: string | null;
  createdAt: string;
}

interface Dist {
  level: string;
  count: number;
}

export default function LaporanPage() {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [dist, setDist] = useState<Dist[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    Promise.all([
      api<{ items: Movement[] }>('/api/v1/inventory/movements?pageSize=50'),
      api<{ priorityDistribution: Dist[] }>('/api/v1/dashboard'),
    ])
      .then(([m, d]) => {
        setMovements(m.items ?? []);
        setDist(d.priorityDistribution ?? []);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const filteredMovements = useMemo(() => {
    if (!search.trim()) return movements;
    const q = search.toLowerCase();
    return movements.filter(
      (m) =>
        m.sku.toLowerCase().includes(q) ||
        m.warehouseName.toLowerCase().includes(q) ||
        (m.reason && m.reason.toLowerCase().includes(q)) ||
        (m.actorName && m.actorName.toLowerCase().includes(q)),
    );
  }, [movements, search]);

  if (loading) return <LoadingState message="Memuat buku besar audit inventori..." />;
  if (error) return <ErrorState message={error} onRetry={() => { setLoading(true); setError(''); load(); }} />;

  return (
    <div>
      <PageHeader
        title="Laporan & Buku Besar (Ledger)"
        subtitle="Riwayat audit mutasi stok lengkap dan distribusi prioritas pesanan aktif"
        actions={
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setLoading(true);
              setError('');
              load();
            }}
          >
            <RefreshCw size={14} aria-hidden />
            <span>Muat Ulang</span>
          </button>
        }
      />

      {/* Priority Summary Card */}
      <div className="card mb24">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Layers size={18} style={{ color: 'var(--primary)' }} aria-hidden />
          <h2 style={{ fontSize: 15, fontWeight: 700 }}>Distribusi Prioritas Pesanan Saat Ini</h2>
        </div>
        {dist.length === 0 ? (
          <p className="muted small">Belum ada pesanan aktif.</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {dist.map((d) => (
              <div
                key={d.level}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: 'var(--surface-low)',
                  padding: '6px 12px',
                  borderRadius: 'var(--r-sm)',
                  border: '1px solid var(--divider)',
                }}
              >
                <StatusBadge status={d.level} />
                <span style={{ fontWeight: 700, fontSize: 14 }}>{d.count} pesanan</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Movements Table Section */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <BookOpen size={18} style={{ color: 'var(--secondary)' }} aria-hidden />
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>Buku Besar Mutasi Stok Fisik</h2>
          </div>

          <div className="search-input-wrapper" style={{ maxWidth: 300 }}>
            <Search size={15} aria-hidden />
            <input
              type="text"
              className="search-input"
              placeholder="Cari SKU, gudang, aktor..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {filteredMovements.length === 0 ? (
          <EmptyState
            title={search ? 'Data mutasi tidak ditemukan' : 'Belum ada mutasi stok'}
            description="Setiap penambahan, reservasi, picking, atau pengurangan stok fisik dicatat secara permanen di sini."
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Waktu Mutasi</th>
                  <th>Jenis Mutasi</th>
                  <th>SKU Produk</th>
                  <th>Gudang</th>
                  <th className="num">Perubahan Kuantitas</th>
                  <th>Alasan / Referensi</th>
                  <th>Eksekutor</th>
                </tr>
              </thead>
              <tbody>
                {filteredMovements.map((m) => (
                  <tr key={m.id}>
                    <td className="small muted">{formatDate(m.createdAt)}</td>
                    <td>
                      <StatusBadge status={m.movementType} />
                    </td>
                    <td>
                      <span className="mono" style={{ fontWeight: 600 }}>{m.sku}</span>
                      <div className="small muted">{m.variantName}</div>
                    </td>
                    <td>{m.warehouseName}</td>
                    <td
                      className="num"
                      style={{
                        color: m.quantityDelta < 0 ? 'var(--error)' : 'var(--success)',
                        fontWeight: 700,
                        fontSize: 14,
                      }}
                    >
                      {m.quantityDelta > 0 ? `+${m.quantityDelta}` : m.quantityDelta}
                    </td>
                    <td className="small">{m.reason ?? '—'}</td>
                    <td className="small muted">{m.actorName ?? 'Sistem'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
