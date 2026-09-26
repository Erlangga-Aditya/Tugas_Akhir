'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, ArrowRight,   Boxes, ShoppingCart, Workflow, Truck } from 'lucide-react';
import { api } from '@/lib/api';
import { StatCard, PageHeader, LoadingState, ErrorState, Alert, statusMeta } from '@/components/ui';

interface Metrics {
  ordersDueToday: number;
  ordersLate: number;
  ordersAtRisk: number;
  ordersWaitingStock: number;
  ordersReadyToProcess: number;
  ordersReadyToShip: number;
  returnsWaitingInspection: number;
  pickingInProgress: number;
  ordersCompletedToday: number;
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [dist, setDist] = useState<Array<{ level: string; count: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api<{ metrics: Metrics; priorityDistribution: Array<{ level: string; count: number }> }>('/api/v1/dashboard')
      .then((d) => {
        setMetrics(d.metrics);
        setDist(d.priorityDistribution ?? []);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  // Realtime auto-update whenever background auto-sync completes
  useEffect(() => {
    const handleSync = () => load();
    window.addEventListener('shopee:synced', handleSync);
    return () => window.removeEventListener('shopee:synced', handleSync);
  }, [load]);

  if (loading) return <LoadingState message="Memuat metrik operasional..." />;
  if (error) return <ErrorState message={error} onRetry={() => { setLoading(true); setError(''); load(); }} />;
  if (!metrics) return null;

  const totalPriorityCount = dist.reduce((acc, curr) => acc + curr.count, 0);

  return (
    <div>
      <PageHeader
        title="Pusat Kendali Operasional"
        subtitle="Pantau SLA pesanan, ketersediaan stok fisik gudang, dan kesiapan pengiriman"
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

      {/* Critical SLA Alerts */}
      {(metrics.ordersLate > 0 || metrics.ordersAtRisk > 0) && (
        <div className="mb24">
          <Alert tone="danger">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <strong>Perhatian SLA Pengiriman Mendesak</strong>
              <span>
                Terdapat <strong>{metrics.ordersLate} pesanan terlambat</strong> dan{' '}
                <strong>{metrics.ordersAtRisk} pesanan berisiko terlambat</strong> (&lt; 6 jam). Segera proses pesanan berprioritas kritis di antrian picking.
              </span>
            </div>
          </Alert>
        </div>
      )}

      {/* Responsive Stat Cards Grid */}
      <div className="stat-grid mb24">
        <StatCard
          value={metrics.ordersDueToday}
          label="Batas Kirim Hari Ini"
          hint="Harus dikirim sebelum tenggat"
          tone="warning"
          href="/dashboard/pesanan"
        />
        <StatCard
          value={metrics.ordersLate}
          label="Pesanan Terlambat"
          hint="Melewati batas SLA kurir"
          tone="danger"
          href="/dashboard/pesanan"
        />
        <StatCard
          value={metrics.ordersAtRisk}
          label="Berisiko Terlambat"
          hint="Tersisa kurang dari 6 jam"
          tone="warning"
          href="/dashboard/pesanan"
        />
        <StatCard
          value={metrics.ordersWaitingStock}
          label="Menunggu Stok"
          hint="Stok fisik belum mencukupi"
          tone="warning"
          href="/dashboard/fulfillment"
        />
        <StatCard
          value={metrics.ordersReadyToProcess}
          label="Siap Diproses"
          hint="Stok siap dialokasikan ke picking"
          tone="secondary"
          href="/dashboard/fulfillment"
        />
        <StatCard
          value={metrics.ordersReadyToShip}
          label="Siap Dikirim"
          hint="Menunggu serah terima kurir"
          tone="success"
          href="/dashboard/pengiriman"
        />
        <StatCard
          value={metrics.returnsWaitingInspection}
          label="Retur Perlu QC"
          hint="Paket retur menunggu inspeksi"
          tone="warning"
          href="/dashboard/pengembalian"
        />
        <StatCard
          value={metrics.ordersCompletedToday}
          label="Selesai Hari Ini"
          hint="Paket berhasil diserahkan"
          tone="success"
        />
      </div>

      <div className="grid-2">
        {/* Priority Breakdown Card */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>Distribusi Prioritas Pesanan Aktif</h2>
            <span className="small muted">{totalPriorityCount} Pesanan Total</span>
          </div>

          {dist.length === 0 ? (
            <p className="muted small">Belum ada pesanan aktif dengan perhitungan prioritas.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {dist.map((d) => {
                const m = statusMeta(d.level);
                const percent = totalPriorityCount > 0 ? Math.round((d.count / totalPriorityCount) * 100) : 0;
                const barColor =
                  d.level === 'CRITICAL'
                    ? 'var(--error)'
                    : d.level === 'HIGH'
                    ? 'var(--tertiary)'
                    : d.level === 'MEDIUM'
                    ? 'var(--secondary)'
                    : 'var(--outline)';

                return (
                  <div key={d.level}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span className={`badge badge-${m.tone}`}>{m.label}</span>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>
                        {d.count} pesanan <span className="muted small">({percent}%)</span>
                      </span>
                    </div>
                    <div style={{ height: 6, width: '100%', background: 'var(--outline-variant)', borderRadius: 9999, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${percent}%`, background: barColor, transition: 'width 0.4s ease' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Quick Operational Shortcuts */}
        <div className="card">
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Akses Cepat Alur Gudang</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Link
              href="/dashboard/pesanan"
              className="btn btn-secondary"
              style={{ justifyContent: 'space-between', padding: '10px 14px' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ShoppingCart size={17} style={{ color: 'var(--primary)' }} aria-hidden />
                <span>Daftar Pesanan Marketplace</span>
              </span>
              <ArrowRight size={15} className="muted" aria-hidden />
            </Link>

            <Link
              href="/dashboard/fulfillment"
              className="btn btn-secondary"
              style={{ justifyContent: 'space-between', padding: '10px 14px' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Workflow size={17} style={{ color: 'var(--secondary)' }} aria-hidden />
                <span>Antrian Picking & Packing</span>
              </span>
              <ArrowRight size={15} className="muted" aria-hidden />
            </Link>

            <Link
              href="/dashboard/inventori"
              className="btn btn-secondary"
              style={{ justifyContent: 'space-between', padding: '10px 14px' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Boxes size={17} style={{ color: 'var(--tertiary)' }} aria-hidden />
                <span>Cek Stok & Stock Opname</span>
              </span>
              <ArrowRight size={15} className="muted" aria-hidden />
            </Link>

            <Link
              href="/dashboard/pengiriman"
              className="btn btn-secondary"
              style={{ justifyContent: 'space-between', padding: '10px 14px' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Truck size={17} style={{ color: 'var(--success)' }} aria-hidden />
                <span>Status & Resi Pengiriman</span>
              </span>
              <ArrowRight size={15} className="muted" aria-hidden />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
