'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Search,
  Truck,
  RefreshCw,
  Printer,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Clock,
  
  } from 'lucide-react';
import { api, formatDate, openOfficialLabel } from '@/lib/api';
import { PageHeader, StatusBadge, LoadingState, ErrorState, EmptyState, Alert } from '@/components/ui';

interface TrackingEvent {
  id: string;
  status: string;
  description: string | null;
  occurredAt: string;
}

interface Shipment {
  id: string;
  orderId: string;
  externalOrderId: string;
  shopName: string;
  buyerName: string | null;
  carrier: string | null;
  awb: string | null;
  status: string;
  shippedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  latestEvent: TrackingEvent | null;
}

interface ShipmentDetail extends Shipment {
  events: TrackingEvent[];
}

const STATUS_FILTERS = [
  { label: 'Semua Status', value: 'ALL' },
  { label: 'Menunggu Pengiriman', value: 'PENDING' },
  { label: 'Siap Kirim', value: 'READY_TO_SHIP' },
  { label: 'Diserahkan ke Kurir', value: 'PICKED_UP' },
  { label: 'Dalam Perjalanan', value: 'IN_TRANSIT' },
  { label: 'Terkirim', value: 'DELIVERED' },
  { label: 'Gagal / Retur', value: 'RETURNED' },
] as const;

export default function PengirimanPage() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  // Paginasi: server sudah mengembalikan `pagination`, jadi UI tidak pernah
  // menarik seluruh riwayat pengiriman sekaligus.
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const PAGE_SIZE = 20;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  // Expanded row tracking detail
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<Record<string, ShipmentDetail>>({});
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Label printing state
  const [printingOrderId, setPrintingOrderId] = useState<string | null>(null);

  // Copied AWB indicator
  const [copiedAwb, setCopiedAwb] = useState<string | null>(null);

  const load = useCallback(
    (pageNo: number) => {
      const q = new URLSearchParams({ page: String(pageNo), pageSize: String(PAGE_SIZE) });
      if (statusFilter !== 'ALL') q.set('status', statusFilter);
      if (search.trim()) q.set('search', search.trim());
      return api<{ items: Shipment[]; pagination: { total: number } }>(`/api/v1/shipments?${q}`)
        .then((d) => {
          setShipments(d.items ?? []);
          setTotal(d.pagination?.total ?? 0);
        })
        .catch((e) => setError((e as Error).message))
        .finally(() => setLoading(false));
    },
    [statusFilter, search],
  );

  useEffect(() => {
    void load(page);
  }, [load, page]);

  // Realtime auto-update whenever background auto-sync completes
  useEffect(() => {
    const handleSync = () => void load(page);
    window.addEventListener('shopee:synced', handleSync);
    return () => window.removeEventListener('shopee:synced', handleSync);
  }, [load, page]);

  // Filter & pencarian dijalankan di server (lihat `load`), jadi daftar di
  // layar ini sudah pasti hanya berisi hasil yang cocok. Tidak ada lagi
  // penyaringan dua kali yang bisa membuat tampilan beda dengan data.
  const filteredShipments = shipments;

  // Expand / collapse shipment row and load full event timeline
  async function toggleExpand(shipment: Shipment) {
    if (expandedId === shipment.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(shipment.id);

    if (!detailData[shipment.id]) {
      setLoadingDetail(true);
      try {
        const detail = await api<ShipmentDetail>(`/api/v1/shipments/${shipment.id}`);
        setDetailData((prev) => ({ ...prev, [shipment.id]: detail }));
      } catch {
        // Fallback: use current row data
        setDetailData((prev) => ({
          ...prev,
          [shipment.id]: {
            ...shipment,
            events: shipment.latestEvent ? [shipment.latestEvent] : [],
          },
        }));
      } finally {
        setLoadingDetail(false);
      }
    }
  }

  function handleCopyAwb(awb: string) {
    navigator.clipboard.writeText(awb);
    setCopiedAwb(awb);
    setTimeout(() => setCopiedAwb(null), 2000);
  }

  async function handlePrintLabel(orderId: string, orderSn: string) {
    setPrintingOrderId(orderId);
    setNotice(null);
    try {
      // Label RESMI Shopee: unduh file yang Shopee terbitkan, lalu buka di tab baru.
      // Tidak ada label buatan di aplikasi ini.
      await openOfficialLabel(orderId);
    } catch (err) {
      setNotice({
        tone: 'danger',
        text: `Label resmi pesanan ${orderSn} belum bisa dicetak: ${(err as Error).message}`,
      });
    } finally {
      setPrintingOrderId(null);
    }
  }

  /**
   * Ganti filter/pencarian selalu kembali ke halaman 1. Tanpa ini, operator bisa
   * terjebak di halaman 5 yang sudah kosong setelah filter berubah.
   *
   * Dilakukan di event handler, bukan effect: setState di dalam effect
   * menyebabkan render berantai.
   */
  function applyFilter(value: string) {
    setPage(1);
    setStatusFilter(value);
  }

  function applySearch(value: string) {
    setPage(1);
    setSearch(value);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="Pengiriman & Pelacakan Kurir"
        subtitle="Kelola nomor resi (AWB), kurir ekspedisi, cetak label pengiriman, dan riwayat pelacakan real-time"
        actions={
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setLoading(true);
              setError('');
              void load(page);
            }}
          >
            <RefreshCw size={14} aria-hidden />
            <span>Muat Ulang</span>
          </button>
        }
      />

      {notice && (
        <div className="mb16">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      )}

      {/* Filter Tabs & Search Bar */}
      <div className="card mb20" style={{ padding: '16px' }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <div className="search-input-wrapper" style={{ flex: 1, minWidth: 260 }}>
            <Search size={16} aria-hidden />
            <input
              type="text"
              className="search-input"
              placeholder="Cari No. Resi (AWB), No. Pesanan, Pembeli, Kurir..."
              value={search}
              onChange={(e) => applySearch(e.target.value)}
            />
          </div>
        </div>

        {/* Status Chips */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`btn btn-sm ${statusFilter === f.value ? 'btn-primary' : 'btn-secondary'}`}
              style={{ borderRadius: 20, fontSize: 12, padding: '4px 12px' }}
              onClick={() => applyFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingState message="Memuat daftar pengiriman..." />
      ) : error ? (
        <ErrorState
          message={error}
          onRetry={() => {
            setLoading(true);
            setError('');
            void load(page);
          }}
        />
      ) : filteredShipments.length === 0 ? (
        <EmptyState
          title={search || statusFilter !== 'ALL' ? 'Pengiriman tidak ditemukan' : 'Belum ada data pengiriman'}
          description={
            search || statusFilter !== 'ALL'
              ? 'Tidak ditemukan pengiriman yang cocok dengan filter atau kata kunci pencarian.'
              : 'Data pengiriman otomatis disinkronkan saat ada pesanan aktif dengan nomor resi dari Shopee atau setelah dilakukan handover kurir.'
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 36 }}></th>
                <th>No. Resi (AWB)</th>
                <th>No. Pesanan</th>
                <th>Toko & Pembeli</th>
                <th>Ekspedisi</th>
                <th>Status Terkini</th>
                <th>Waktu Kirim</th>
                <th style={{ textAlign: 'center' }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filteredShipments.map((s) => {
                const isExpanded = expandedId === s.id;
                const detail = detailData[s.id];
                const isPrinting = printingOrderId === s.orderId;

                return (
                  <>
                    <tr key={s.id} style={{ background: isExpanded ? 'var(--subtle)' : undefined }}>
                      <td>
                        <button
                          type="button"
                          className="btn btn-icon btn-sm"
                          title="Lihat Timeline Tracking"
                          onClick={() => toggleExpand(s)}
                          style={{ padding: 4 }}
                        >
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Truck size={15} style={{ color: 'var(--primary)', flexShrink: 0 }} aria-hidden />
                          <span className="mono" style={{ fontWeight: 700, fontSize: 13 }}>
                            {s.awb ?? 'Menunggu Resi'}
                          </span>
                          {s.awb && (
                            <button
                              type="button"
                              className="btn btn-icon btn-sm"
                              title="Salin Nomor Resi"
                              onClick={() => handleCopyAwb(s.awb!)}
                              style={{ padding: 2, border: 'none', background: 'transparent', cursor: 'pointer' }}
                            >
                              {copiedAwb === s.awb ? (
                                <Check size={13} style={{ color: 'var(--success)' }} />
                              ) : (
                                <Copy size={13} className="muted" />
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className="mono" style={{ fontSize: 12 }}>
                          {s.externalOrderId}
                        </span>
                      </td>
                      <td>
                        <div style={{ fontWeight: 500, fontSize: 13 }}>{s.buyerName ?? '—'}</div>
                        <div className="small muted">{s.shopName}</div>
                      </td>
                      <td>
                        <span className="badge badge-neutral">{s.carrier ?? 'Reguler'}</span>
                      </td>
                      <td>
                        <StatusBadge status={s.status} />
                        {s.latestEvent && (
                          <div
                            className="small muted"
                            style={{
                              marginTop: 4,
                              maxWidth: 220,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                            title={s.latestEvent.description || s.latestEvent.status}
                          >
                            {s.latestEvent.description || s.latestEvent.status}
                          </div>
                        )}
                      </td>
                      <td className="small muted">{formatDate(s.shippedAt || s.createdAt)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={isPrinting}
                            onClick={() => handlePrintLabel(s.orderId, s.externalOrderId)}
                            title="Cetak Dokumen Pengiriman / Label Resi"
                          >
                            <Printer size={13} aria-hidden />
                            <span>{isPrinting ? 'Menyiapkan...' : 'Cetak Label'}</span>
                          </button>

                        </div>
                      </td>
                    </tr>

                    {/* Collapsible Tracking Timeline */}
                    {isExpanded && (
                      <tr key={`${s.id}-timeline`} style={{ background: 'var(--subtle)' }}>
                        <td colSpan={8} style={{ padding: '16px 24px' }}>
                          <div
                            style={{
                              background: 'var(--surface)',
                              border: '1px solid var(--border)',
                              borderRadius: 8,
                              padding: 16,
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                marginBottom: 12,
                              }}
                            >
                              <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Clock size={14} style={{ color: 'var(--primary)' }} />
                                Riwayat Perjalanan Paket (Tracking Timeline)
                              </div>
                              <span className="small muted">
                                Kurir: <strong>{s.carrier ?? 'Ekspedisi'}</strong> | Resi: <strong>{s.awb ?? '—'}</strong>
                              </span>
                            </div>

                            {loadingDetail && !detail ? (
                              <div className="small muted" style={{ textAlign: 'center', padding: '12px 0' }}>
                                Memuat riwayat pelacakan kurir...
                              </div>
                            ) : !detail?.events || detail.events.length === 0 ? (
                              <div className="small muted" style={{ textAlign: 'center', padding: '12px 0' }}>
                                Belum ada riwayat event pelacakan logistik untuk nomor resi ini.
                              </div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                {detail.events.map((event, idx) => (
                                  <div
                                    key={event.id || idx}
                                    style={{
                                      display: 'flex',
                                      gap: 12,
                                      alignItems: 'flex-start',
                                      position: 'relative',
                                      paddingLeft: 4,
                                    }}
                                  >
                                    <div
                                      style={{
                                        width: 10,
                                        height: 10,
                                        borderRadius: '50%',
                                        background: idx === 0 ? 'var(--primary)' : 'var(--border)',
                                        marginTop: 4,
                                        flexShrink: 0,
                                      }}
                                    />
                                    <div style={{ flex: 1 }}>
                                      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                                        <span style={{ fontWeight: 600, fontSize: 13 }}>
                                          {event.description || event.status}
                                        </span>
                                        <span className="badge badge-neutral" style={{ fontSize: 10 }}>
                                          {event.status}
                                        </span>
                                      </div>
                                      <div className="small muted" style={{ marginTop: 2 }}>
                                        {formatDate(event.occurredAt)}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
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


      {total > PAGE_SIZE && (
        <div className="pagination" style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <span>Sebelumnya</span>
          </button>
          <span className="small muted">
            Halaman {page} dari {totalPages} ({total} kiriman)
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            <span>Berikutnya</span>
          </button>
        </div>
      )}
    </div>
  );
}
