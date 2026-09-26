'use client';

import { useCallback, useEffect, useState, useMemo } from 'react';
import {
  PackageCheck,
  ClipboardCheck,
  Search,
  RefreshCw,
  Undo2,
  Cable,
  ChevronDown,
  ChevronUp,
  
  Package,
} from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, StatusBadge, LoadingState, ErrorState, EmptyState, Alert, Modal } from '@/components/ui';

interface RetItem {
  id: string;
  sku: string;
  variantName: string;
  /** Jumlah yang Shopee janjikan akan kembali. */
  quantity: number;
  /** Jumlah yang benar-benar tercatat sudah datang di gudang (hasil pindai). */
  scannedQuantity: number;
  inspectionResult: string | null;
}

interface Ret {
  id: string;
  externalReturnId: string | null;
  status: string;
  reason: string | null;
  order: { externalOrderId: string; shopName: string };
  items: RetItem[];
  createdAt: string;
}

const RESULTS = [
  { key: 'SELLABLE', label: 'Layak Jual (Restok Kembali ke Saldo Tersedia)' },
  { key: 'DAMAGED', label: 'Rusak / Cacat (Catat ke Saldo Rusak)' },
  { key: 'PARTIAL', label: 'Sebagian Layak' },
  { key: 'REJECTED', label: 'Ditolak (Tidak Direstok)' },
] as const;

const STATUS_FILTERS = [
  { label: 'Semua Retur', value: 'ALL' },
  { label: 'Diajukan / Di Jalan', value: 'REQUESTED' },
  { label: 'Diterima di Gudang', value: 'RECEIVED' },
  { label: 'Proses Inspeksi QC', value: 'INSPECTION' },
  { label: 'Selesai Direstok', value: 'RESTOCKED' },
  { label: 'Barang Rusak', value: 'DAMAGED' },
] as const;

export default function PengembalianPage() {
  const [returns, setReturns] = useState<Ret[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [syncingReturns, setSyncingReturns] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [arrivalModal, setArrivalModal] = useState<Ret | null>(null);
  const [arrivalQty, setArrivalQty] = useState<Record<string, string>>({});
  const [qcModal, setQcModal] = useState<Ret | null>(null);
  const [qc, setQc] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    api<{ items: Ret[] }>('/api/v1/returns')
      .then((d) => setReturns(d.items ?? []))
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

  const filteredReturns = useMemo(() => {
    return returns.filter((r) => {
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        (r.externalReturnId && r.externalReturnId.toLowerCase().includes(q)) ||
        r.order.externalOrderId.toLowerCase().includes(q) ||
        (r.reason && r.reason.toLowerCase().includes(q)) ||
        r.items.some((i) => i.sku.toLowerCase().includes(q) || i.variantName.toLowerCase().includes(q))
      );
    });
  }, [returns, search, statusFilter]);

  async function handleSyncReturns() {
    setSyncingReturns(true);
    setNotice(null);
    try {
      const res = await api<{ count: number }>('/api/v1/integrations/shopee/sync-returns', {
        method: 'POST',
      });
      setNotice({
        tone: 'success',
        text: `Sinkronisasi retur selesai. ${res.count ?? 0} data retur Shopee diperbarui.`,
      });
      load();
    } catch (e) {
      setNotice({ tone: 'danger', text: `Gagal sinkronkan retur: ${(e as Error).message}` });
    } finally {
      setSyncingReturns(false);
    }
  }

  /**
   * Catat barang retur yang benar-benar sudah datang di gudang.
   *
   * Stok BELUM bertambah di sini. Retur hanya ditandai "sampai" kalau seluruh
   * isinya tercatat, dan baru setelah itu tombol "Terima Fisik" terbuka.
   */
  async function submitArrival(e: React.FormEvent) {
    e.preventDefault();
    if (!arrivalModal) return;
    setNotice(null);
    setSubmitting(true);
    try {
      const items = arrivalModal.items.map((i) => ({
        returnItemId: i.id,
        scannedQuantity: Number(arrivalQty[i.id] ?? 0),
      }));
      if (items.some((i) => !Number.isInteger(i.scannedQuantity) || i.scannedQuantity < 0)) {
        setNotice({ tone: 'danger', text: 'Jumlah barang yang datang harus angka bulat 0 atau lebih.' });
        return;
      }
      const res = await api<{ message: string; fullyArrived: boolean }>(
        `/api/v1/returns/${arrivalModal.id}/arrival`,
        { method: 'POST', body: { items } },
      );
      setNotice({
        tone: 'success',
        text: res.message +
          (res.fullyArrived ? '' : ' Barang yang belum dicatat tidak menambah stok.'),
      });
      setArrivalModal(null);
      setArrivalQty({});
      load();
    } catch (err) {
      setNotice({ tone: 'danger', text: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  async function receive(id: string) {
    setNotice(null);
    try {
      await api(`/api/v1/returns/${id}/receive`, { method: 'POST' });
      setNotice({ tone: 'success', text: 'Paket retur berhasil ditandai diterima di gudang.' });
      load();
    } catch (e) {
      setNotice({ tone: 'danger', text: (e as Error).message });
    }
  }

  async function submitQc(e: React.FormEvent) {
    e.preventDefault();
    if (!qcModal) return;
    setNotice(null);
    setSubmitting(true);
    try {
      const warehouses = await api<Array<{ id: string }>>('/api/v1/warehouses');
      const warehouseId = warehouses[0]?.id;
      if (!warehouseId) {
        setNotice({ tone: 'danger', text: 'Belum ada gudang aktif untuk lokasi restok.' });
        return;
      }
      const items = qcModal.items.map((i) => ({ returnItemId: i.id, result: qc[i.id] ?? 'REJECTED' }));
      await api(`/api/v1/returns/${qcModal.id}/qc`, { method: 'POST', body: { warehouseId, items } });
      setNotice({ tone: 'success', text: 'Hasil QC berhasil disimpan dan buku besar mutasi inventori telah diperbarui.' });
      setQcModal(null);
      load();
    } catch (e) {
      setNotice({ tone: 'danger', text: (e as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Pengembalian Barang (Retur)"
        subtitle="Inspeksi Quality Control (QC) paket retur pembeli, kelayakan fisik barang, dan pemulihan saldo stok otomatis"
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
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
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={syncingReturns}
              onClick={handleSyncReturns}
            >
              <Cable size={14} aria-hidden />
              <span>{syncingReturns ? 'Menyinkronkan...' : 'Sinkronkan Retur Shopee'}</span>
            </button>
          </div>
        }
      />

      {notice && (
        <div className="mb16">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      )}

      {/* Filter & Search */}
      <div className="card mb20" style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <div className="search-input-wrapper" style={{ flex: 1, minWidth: 260 }}>
            <Search size={16} aria-hidden />
            <input
              type="text"
              className="search-input"
              placeholder="Cari No. Retur, No. Pesanan, SKU produk, atau alasan..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`btn btn-sm ${statusFilter === f.value ? 'btn-primary' : 'btn-secondary'}`}
              style={{ borderRadius: 20, fontSize: 12, padding: '4px 12px' }}
              onClick={() => setStatusFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingState message="Memuat daftar pengembalian..." />
      ) : error ? (
        <ErrorState
          message={error}
          onRetry={() => {
            setLoading(true);
            setError('');
            load();
          }}
        />
      ) : filteredReturns.length === 0 ? (
        <EmptyState
          title={search || statusFilter !== 'ALL' ? 'Data retur tidak ditemukan' : 'Belum ada pengembalian aktif'}
          description={
            search || statusFilter !== 'ALL'
              ? 'Tidak ada data retur yang cocok dengan kata kunci atau status filter yang dipilih.'
              : 'Data pengembalian barang masuk otomatis dari Shopee via fitur auto-sync atau klik "Sinkronkan Retur Shopee".'
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 36 }}></th>
                <th>No. Retur</th>
                <th>No. Pesanan & Toko</th>
                <th>Status Retur</th>
                <th>Alasan Pengembalian</th>
                <th className="num">Jml Item</th>
                <th style={{ textAlign: 'center' }}>Tindakan QC</th>
              </tr>
            </thead>
            <tbody>
              {filteredReturns.map((r) => {
                const isExpanded = expandedId === r.id;

                return (
                  <>
                    <tr key={r.id} style={{ background: isExpanded ? 'var(--subtle)' : undefined }}>
                      <td>
                        <button
                          type="button"
                          className="btn btn-icon btn-sm"
                          title="Lihat Detail Item Retur"
                          onClick={() => setExpandedId(isExpanded ? null : r.id)}
                          style={{ padding: 4 }}
                        >
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Undo2 size={15} style={{ color: 'var(--primary)', flexShrink: 0 }} aria-hidden />
                          <span className="mono" style={{ fontWeight: 700, fontSize: 13 }}>
                            {r.externalReturnId ?? 'Menunggu ID Retur'}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="mono" style={{ fontSize: 12 }}>
                          {r.order.externalOrderId}
                        </div>
                        <div className="small muted">{r.order.shopName}</div>
                      </td>
                      <td>
                        <StatusBadge status={r.status} />
                      </td>
                      <td>
                        <div style={{ maxWidth: 280, fontSize: 13 }} className="muted">
                          {r.reason ?? 'Tidak ada alasan terlampir'}
                        </div>
                      </td>
                      <td className="num">
                        <span style={{ fontWeight: 600 }}>{r.items.length} item</span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {(r.status === 'REQUESTED' || r.status === 'IN_TRANSIT') && (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => {
                              setArrivalModal(r);
                              // Default: semua barang dianggap belum datang.
                              setArrivalQty({});
                            }}
                          >
                            <PackageCheck size={13} aria-hidden />
                            <span>Catat Barang Datang</span>
                          </button>
                        )}
                        {r.status === 'ARRIVED' && (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => receive(r.id)}
                          >
                            <PackageCheck size={13} aria-hidden />
                            <span>Terima Fisik</span>
                          </button>
                        )}
                        {(r.status === 'RECEIVED' || r.status === 'INSPECTION') && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                              setQcModal(r);
                              setQc({});
                            }}
                          >
                            <ClipboardCheck size={13} aria-hidden />
                            <span>Inspeksi QC</span>
                          </button>
                        )}
                        {r.status === 'RESTOCKED' && (
                          <span className="badge badge-success">Selesai Restok</span>
                        )}
                        {r.status === 'DAMAGED' && (
                          <span className="badge badge-danger">Barang Rusak</span>
                        )}
                      </td>
                    </tr>

                    {/* Expandable item details */}
                    {isExpanded && (
                      <tr key={`${r.id}-detail`} style={{ background: 'var(--subtle)' }}>
                        <td colSpan={7} style={{ padding: '12px 24px' }}>
                          <div
                            style={{
                              background: 'var(--surface)',
                              border: '1px solid var(--border)',
                              borderRadius: 8,
                              padding: 14,
                            }}
                          >
                            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                              <Package size={14} style={{ color: 'var(--primary)' }} />
                              Daftar Barang yang Dikembalikan:
                            </div>
                            <table className="table" style={{ margin: 0, fontSize: 12 }}>
                              <thead>
                                <tr>
                                  <th>SKU</th>
                                  <th>Nama Varian</th>
                                  <th className="num">Janji Shopee</th>
                                  <th className="num">Sudah Datang</th>
                                  <th>Hasil Inspeksi QC</th>
                                </tr>
                              </thead>
                              <tbody>
                                {r.items.map((item) => (
                                  <tr key={item.id}>
                                    <td className="mono">{item.sku}</td>
                                    <td>{item.variantName}</td>
                                    <td className="num">{item.quantity} pcs</td>
                                    <td className="num">
                                      <strong style={{ color: item.scannedQuantity > 0 ? 'var(--success)' : 'var(--muted)' }}>
                                        {item.scannedQuantity} pcs
                                      </strong>
                                    </td>
                                    <td>
                                      {item.inspectionResult ? (
                                        <span className="badge badge-neutral">{item.inspectionResult}</span>
                                      ) : (
                                        <span className="small muted">Menunggu QC</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Accessible QC Inspection Modal */}
      {/* Modal: catat barang retur yang benar-benar sudah datang di gudang */}
      <Modal
        isOpen={Boolean(arrivalModal)}
        onClose={() => setArrivalModal(null)}
        title={`Barang Retur yang Sudah Datang — ${arrivalModal?.externalReturnId ?? arrivalModal?.order.externalOrderId ?? ''}`}
      >
        <form onSubmit={submitArrival}>
          <p className="small muted" style={{ margin: '0 0 14px', lineHeight: 1.55 }}>
            Hitung barang yang benar-benar ada di gudang. Paket retur belum tentu semua isinya sudah
            sampai. <strong>Stok belum bertambah di langkah ini</strong> — stok baru naik setelah
            semua barang tercatat lalu Anda menekan &quot;Terima Fisik&quot; dan mengisi hasil inspeksi.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Barang</th>
                  <th className="num">Janji Shopee</th>
                  <th className="num">Sudah datang</th>
                </tr>
              </thead>
              <tbody>
                {arrivalModal?.items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <div className="mono" style={{ fontWeight: 600 }}>{i.sku}</div>
                      <div className="small muted">{i.variantName}</div>
                    </td>
                    <td className="num">{i.quantity}</td>
                    <td className="num" style={{ width: 110 }}>
                      <input
                        className="input"
                        inputMode="numeric"
                        value={arrivalQty[i.id] ?? ''}
                        onChange={(e) => setArrivalQty({ ...arrivalQty, [i.id]: e.target.value })}
                        placeholder="0"
                        max={i.quantity}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button type="submit" className="btn btn-primary grow" disabled={submitting}>
              {submitting ? 'Menyimpan...' : 'Simpan Barang yang Datang'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setArrivalModal(null)}>
              Batal
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={Boolean(qcModal)}
        onClose={() => setQcModal(null)}
        title={`Inspeksi QC Retur — ${qcModal?.externalReturnId ?? qcModal?.order.externalOrderId}`}
      >
        <form onSubmit={submitQc}>
          <p className="muted small mb16">
            Tentukan kelayakan fisik setiap barang untuk menentukan apakah stok akan dikembalikan ke saldo inventori atau dicatat sebagai barang rusak.
          </p>

          {qcModal?.items.map((i) => (
            <div key={i.id} className="field mb16">
              <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="mono" style={{ fontWeight: 700 }}>{i.sku}</span>
                <span>{i.quantity} pcs</span>
              </label>
              <div className="small muted mb8">{i.variantName}</div>
              <select
                className="input"
                value={qc[i.id] ?? ''}
                onChange={(e) => setQc({ ...qc, [i.id]: e.target.value })}
                required
              >
                <option value="" disabled>
                  Pilih Hasil Kelayakan QC...
                </option>
                {RESULTS.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
            <button
              type="submit"
              className="btn btn-primary grow"
              disabled={submitting || (qcModal ? Object.keys(qc).length < qcModal.items.length : true)}
            >
              {submitting ? 'Menyimpan...' : 'Simpan Hasil QC & Perbarui Stok'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setQcModal(null)}>
              Batal
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
