'use client';

import { useCallback, useEffect, useState } from 'react';
import { Boxes, ClipboardCheck, Plus, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { Alert } from '@/components/ui';

/**
 * Panel Stok Gudang — dipakai bersama oleh halaman "Pesanan & Pengiriman" dan
 * "Stok Gudang" supaya perilakunya persis sama (satu sumber kode, bukan duplikat).
 *
 * Produk diambil otomatis dari toko Shopee (hasil sinkronisasi), bisa ditambah
 * (barang masuk → batch baru) maupun dikoreksi lewat hitung fisik.
 *
 * CATATAN DESAIN PENTING
 * ----------------------
 * Koreksi stok TIDAK memakai input `+5` / `-3`. Yang diketahui operator hanyalah
 * "ada 32 pcs di rak". Jadi inputnya adalah angka stok fisik hasil hitung, dan
 * server yang menghitung selisihnya. Alasan wajib diisi karena itu yang
 * menjelaskan selisihnya.
 */

interface StockOption {
  variantId: string;
  productName: string;
  sku: string;
  variantName: string;
  shopName: string | null;
  onHand: number;
  available: number;
  oldestLotAt: string | null;
}

/** Alasan koreksi — cerminan `ADJUSTMENT_REASONS` di server. */
const ADJUSTMENT_REASONS: Array<{ value: string; label: string }> = [
  { value: 'STOCK_COUNT', label: 'Hasil hitung fisik' },
  { value: 'DAMAGE', label: 'Barang rusak' },
  { value: 'EXPIRY', label: 'Kedaluwarsa' },
  { value: 'THEFT', label: 'Hilang' },
  { value: 'TRANSFER', label: 'Pindah gudang' },
  { value: 'RECEIVING_ERROR', label: 'Salah catat barang masuk' },
  { value: 'OTHER', label: 'Lainnya' },
];

export interface StockPanelProps {
  open: boolean;
  onClose: () => void;
  warehouseId: string | null;
  prefillVariantId: string | null;
  onDone: (message: string) => void;
}

/** Stok Gudang: produk otomatis dari toko Shopee, bisa ditambah maupun dikurangi. */
export function StockPanel({ open, onClose, warehouseId, prefillVariantId, onDone }: StockPanelProps) {
  const [mode, setMode] = useState<'masuk' | 'koreksi'>('masuk');
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<StockOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<StockOption | null>(null);
  const [quantity, setQuantity] = useState('');
  const [countedOnHand, setCountedOnHand] = useState('');
  const [reason, setReason] = useState('STOCK_COUNT');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadOptions = useCallback(async (keyword: string) => {
    await Promise.resolve();
    setLoading(true);
    try {
      const res = await api<{ items: StockOption[] }>(
        `/api/v1/inventory/stock-in/options?search=${encodeURIComponent(keyword)}`,
      );
      setOptions(res.items);
      return res.items;
    } catch (e) {
      setError((e as Error).message);
      return [] as StockOption[];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      const list = await loadOptions('');
      if (cancelled || !prefillVariantId) return;
      const found = list.find((o) => o.variantId === prefillVariantId);
      if (found) setSelected(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, prefillVariantId, loadOptions]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      if (cancelled) return;
      await loadOptions(search);
    })();
    return () => {
      cancelled = true;
    };
  }, [search, open, loadOptions]);

  if (!open) return null;

  async function submit() {
    if (!selected || !warehouseId) return;
    setBusy(true);
    setError('');
    try {
      if (mode === 'masuk') {
        const qty = Number(quantity);
        if (!Number.isInteger(qty) || qty <= 0) {
          setError('Jumlah barang masuk harus angka bulat lebih dari 0.');
          return;
        }
        const res = await api<{ message: string }>('/api/v1/inventory/stock-in', {
          method: 'POST',
          body: {
            warehouseId,
            variantId: selected.variantId,
            quantity: qty,
            notes: notes || undefined,
          },
        });
        onDone(res.message);
      } else {
        // Koreksi: kirim ANGKA STOK FISIK, bukan selisih +/-.
        const counted = Number(countedOnHand);
        if (countedOnHand.trim() === '' || !Number.isInteger(counted) || counted < 0) {
          setError('Stok hasil hitung harus angka bulat 0 atau lebih.');
          return;
        }
        if (counted === selected.onHand) {
          setError('Stok hasil hitung sama dengan stok sistem. Tidak ada yang perlu disesuaikan.');
          return;
        }
        if (reason === 'OTHER' && !notes.trim()) {
          setError('Untuk alasan "Lainnya", isi catatan penjelasan.');
          return;
        }
        const res = await api<{ message: string }>('/api/v1/inventory/adjustments', {
          method: 'POST',
          body: {
            warehouseId,
            variantId: selected.variantId,
            countedOnHand: counted,
            // Dikirim supaya server bisa menolak kalau stok sudah berubah
            // di antara form dibuka dan tombol ditekan.
            expectedOnHand: selected.onHand,
            reason,
            notes: notes || undefined,
          },
        });
        onDone(res.message);
      }
      setQuantity('');
      setCountedOnHand('');
      setNotes('');
      const list = await loadOptions(search);
      const updated = list.find((o) => o.variantId === selected.variantId);
      if (updated) setSelected(updated);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mb20">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Boxes size={18} aria-hidden />
            <span>Stok Gudang</span>
          </h2>
          <p className="small muted" style={{ margin: 0, lineHeight: 1.5, maxWidth: 760 }}>
            Daftar produk diambil otomatis dari toko Shopee Anda. Angka stok di Shopee sering diisi asal, jadi
            sistem ini memakai stok gudang sendiri: barang yang <strong>masuk lebih dulu akan keluar lebih dulu</strong>.
          </p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          <span>Tutup</span>
        </button>
      </div>

      <div className="filter-chips" style={{ margin: '12px 0 10px' }}>
        <button
          type="button"
          className={`btn btn-sm ${mode === 'masuk' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setMode('masuk')}
        >
          <Plus size={13} aria-hidden />
          <span>Barang Masuk</span>
        </button>
        <button
          type="button"
          className={`btn btn-sm ${mode === 'koreksi' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setMode('koreksi')}
        >
          <ClipboardCheck size={13} aria-hidden />
          <span>Hitung Stok Fisik</span>
        </button>
      </div>

      <div style={{ position: 'relative', marginBottom: 10 }}>
        <Search
          size={15}
          aria-hidden
          style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }}
        />
        <input
          className="input"
          style={{ paddingLeft: 32 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari produk Shopee (nama, kode/SKU, barcode)"
        />
      </div>

      <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Produk Shopee</th>
              <th>Kode</th>
              <th className="num">Stok gudang</th>
              <th style={{ textAlign: 'center' }}>Pilih</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4} className="small muted">Memuat produk dari Shopee...</td>
              </tr>
            )}
            {!loading && options.length === 0 && (
              <tr>
                <td colSpan={4} className="small muted">
                  Produk belum ada. Sinkronkan dulu di menu &quot;Hubungkan Shopee&quot; → tombol &quot;Sinkronkan Produk&quot;.
                </td>
              </tr>
            )}
            {!loading &&
              options.map((o) => (
                <tr key={o.variantId} style={selected?.variantId === o.variantId ? { background: 'var(--surface-low, #f8fafc)' } : undefined}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{o.productName}</div>
                    <div className="small muted">{o.variantName}</div>
                  </td>
                  <td><code className="mono">{o.sku}</code></td>
                  <td className="num">{o.onHand}</td>
                  <td style={{ textAlign: 'center' }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelected(o)}>
                      <span>{selected?.variantId === o.variantId ? 'Terpilih' : 'Pilih'}</span>
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div
          style={{
            marginTop: 12,
            border: '1px solid var(--outline-variant, #e2e8f0)',
            borderRadius: 12,
            padding: 14,
            background: 'var(--surface-low, #f8fafc)',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>
            {selected.productName} — <code className="mono">{selected.sku}</code> (stok sistem: {selected.onHand})
          </div>
          {mode === 'masuk' ? (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ width: 130 }}>
                <label style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                  Jumlah barang masuk
                </label>
                <input
                  className="input"
                  inputMode="numeric"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div style={{ flex: '1 1 220px' }}>
                <label style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                  Catatan (opsional)
                </label>
                <input
                  className="input"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Contoh: produksi 23 Sep"
                />
              </div>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>
                <Plus size={15} aria-hidden />
                <span>{busy ? 'Menyimpan...' : 'Simpan Barang Masuk'}</span>
              </button>
            </div>
          ) : (
            <>
              <p className="small muted" style={{ margin: '0 0 12px', lineHeight: 1.55 }}>
                Hitung barang yang benar-benar ada di gudang, lalu masukkan angkanya. Sistem menghitung
                sendiri selisihnya dan mencatat alasan koreksi.
              </p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ width: 160 }}>
                  <label style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                    Stok hasil hitung
                  </label>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={countedOnHand}
                    onChange={(e) => setCountedOnHand(e.target.value)}
                    placeholder={String(selected.onHand)}
                  />
                </div>
                <div style={{ width: 220 }}>
                  <label style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                    Alasan
                  </label>
                  <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
                    {ADJUSTMENT_REASONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: '1 1 220px' }}>
                  <label style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                    Catatan
                    {reason === 'OTHER' ? ' (wajib)' : ' (opsional)'}
                  </label>
                  <input
                    className="input"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Contoh: 2 pcs hilang saat kirim"
                  />
                </div>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>
                  <ClipboardCheck size={15} aria-hidden />
                  <span>{busy ? 'Menyimpan...' : 'Simpan Hasil Hitung'}</span>
                </button>
              </div>
              {countedOnHand.trim() !== '' && Number(countedOnHand) !== selected.onHand && (
                <p className="small" style={{ margin: '10px 0 0', color: 'var(--muted)' }}>
                  Selisih:{' '}
                  <strong>
                    {Number(countedOnHand) > selected.onHand ? '+' : ''}
                    {Number(countedOnHand) - selected.onHand}
                  </strong>{' '}
                  unit ({selected.onHand} → {countedOnHand})
                </p>
              )}
            </>
          )}
        </div>
      )}

      {error && <Alert tone="danger">{error}</Alert>}
      {!warehouseId && <Alert tone="warning">Belum ada gudang aktif. Tambahkan gudang di menu Pengaturan.</Alert>}
    </div>
  );
}
