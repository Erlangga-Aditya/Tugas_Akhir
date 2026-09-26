'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Pencil, Search, Warehouse, Boxes } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, LoadingState, ErrorState, EmptyState, Alert } from '@/components/ui';
import { StockPanel } from '@/components/stock-panel';

interface InvItem {
  id: string;
  variantId: string;
  warehouseId: string;
  sku: string;
  productName: string;
  variantName: string;
  barcode: string | null;
  onHand: number;
  reserved: number;
  available: number;
}

export default function InventoriPage() {
  const [items, setItems] = useState<InvItem[]>([]);
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const [stockOpen, setStockOpen] = useState(false);
  // Penyesuaian stok TIDAK punya modal sendiri di halaman ini. Semua aksi
  // masuk/koreksi berada di satu komponen `StockPanel` supaya tidak ada dua
  // implementasi untuk aksi bisnis yang sama (duplikasi = sumber bug).

  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (warehouseId) q.set('warehouseId', warehouseId);
    if (search) q.set('search', search);
    api<{ items: InvItem[] }>(`/api/v1/inventory?${q.toString()}`)
      .then((d) => setItems(d.items ?? []))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [warehouseId, search]);

  useEffect(() => {
    api<Array<{ id: string; name: string }>>('/api/v1/warehouses')
      .then((w) => {
        setWarehouses(w);
        if (w[0]) setWarehouseId(w[0].id);
      })
      .catch(() => undefined);
  }, []);

  useEffect(load, [load]);

  // Realtime auto-update whenever background auto-sync completes
  useEffect(() => {
    const handleSync = () => load();
    window.addEventListener('shopee:synced', handleSync);
    return () => window.removeEventListener('shopee:synced', handleSync);
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Stok Gudang"
        subtitle="Stok per gudang, pencatatan barang masuk/keluar, dan riwayat perubahan stok"
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setStockOpen(true)}>
              <Boxes size={14} aria-hidden />
              <span>Barang Masuk / Kurangi</span>
            </button>
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
          </div>
        }
      />

      <StockPanel
        open={stockOpen}
        onClose={() => setStockOpen(false)}
        warehouseId={warehouseId || null}
        prefillVariantId={null}
        onDone={(message) => {
          setNotice({ tone: 'success', text: message });
          load();
        }}
      />

      {notice ? (
        <div className="mb16">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      ) : null}

      {/* Responsive Filter Bar */}
      <div className="filter-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 180 }}>
          <Warehouse size={16} style={{ color: 'var(--on-surface-variant)' }} aria-hidden />
          <select
            className="input"
            style={{ width: '100%', maxWidth: 220, height: 38 }}
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>

        <div className="search-input-wrapper">
          <Search size={16} aria-hidden />
          <input
            type="text"
            className="search-input"
            placeholder="Cari SKU / nama produk..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <LoadingState message="Memuat data persediaan gudang..." />
      ) : error ? (
        <ErrorState
          message={error}
          onRetry={() => {
            setLoading(true);
            setError('');
            load();
          }}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="Tidak ada data stok produk"
          description="Sinkronkan katalog produk dari Shopee atau lakukan penambahan stok awal."
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Produk & Varian</th>
                <th>Barcode</th>
                <th className="num">Stok Fisik (On Hand)</th>
                <th className="num">Ter-Reserve</th>
                <th className="num">Tersedia Dijual</th>
                <th style={{ textAlign: 'center' }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Boxes size={15} style={{ color: 'var(--primary)', flexShrink: 0 }} aria-hidden />
                      <span className="mono" style={{ fontWeight: 700 }}>{it.sku}</span>
                    </div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{it.productName}</div>
                    <div className="small muted">{it.variantName}</div>
                  </td>
                  <td>
                    <span className="mono small" style={{ color: it.barcode ? 'var(--on-surface)' : 'var(--on-surface-muted)' }}>
                      {it.barcode ?? '—'}
                    </span>
                  </td>
                  <td className="num">
                    <span style={{ fontWeight: 500 }}>{it.onHand}</span>
                  </td>
                  <td className="num">
                    <span style={{ color: it.reserved > 0 ? 'var(--on-tertiary-container)' : 'var(--on-surface-muted)', fontWeight: it.reserved > 0 ? 600 : 400 }}>
                      {it.reserved}
                    </span>
                  </td>
                  <td className="num">
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: 14,
                        color: it.available > 0 ? 'var(--success)' : 'var(--error)',
                      }}
                    >
                      {it.available}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        // Buka panel yang sama dengan halaman Pesanan — satu
                        // implementasi untuk satu aksi bisnis.
                        setStockOpen(true);
                      }}
                    >
                      <Pencil size={12} aria-hidden />
                      <span>Hitung Ulang</span>
                    </button>
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
