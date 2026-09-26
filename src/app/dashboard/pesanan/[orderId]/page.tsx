'use client';

import { use, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  
  Truck,
  Printer,
  Package,
  
  User,
  MapPin,
  CheckCircle2,
  
  ExternalLink,
  
  ScanLine,
  Copy,
  Check,
} from 'lucide-react';
import { api, formatDate, formatRupiah , openOfficialLabel } from '@/lib/api';
import {  StatusBadge, LoadingState, ErrorState, Alert } from '@/components/ui';

interface OrderDetail {
  id: string;
  externalOrderId: string;
  status: string;
  shopId: string;
  shopName: string;
  provider: string;
  buyerName: string | null;
  buyerPhone: string | null;
  shippingAddress: Record<string, unknown> | null;
  buyerNote: string | null;
  packageNumber: string | null;
  currency: string | null;
  totalAmount: number | null;
  itemSubtotal: number | null;
  sellerDiscount: number | null;
  shopeeDiscount: number | null;
  buyerShippingFee: number | null;
  shippingFeeDiscount: number | null;
  platformFee: number | null;
  escrowAmount: number | null;
  paymentMethod: string | null;
  isCod: boolean;
  paidAt: string | null;
  placedAt: string;
  shipByAt: string | null;
  awb: string | null;
  carrier: string | null;
  shipmentStatus: string | null;
  canPrintOfficialLabel: boolean;
  items: Array<{
    id: string;
    sku: string;
    productName: string;
    variantName?: string | null;
    barcode?: string | null;
    quantity: number;
    fulfilledQuantity: number;
    unitPrice?: number | null;
    status: string;
    isReserved: boolean;
  }>;
  statusHistory: Array<{
    fromStatus: string | null;
    toStatus: string;
    reason: string | null;
    createdAt: string;
  }>;
  fulfillmentOrders: Array<{
    id: string;
    status: string;
    warehouseName: string;
  }>;
  shipments: Array<{
    id: string;
    awb: string | null;
    carrier: string | null;
    status: string;
    events: Array<{
      id: string;
      status: string;
      description: string | null;
      occurredAt: string;
    }>;
  }>;
}

export default function OrderDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [arranging, setArranging] = useState(false);
 const [printingLabel, setPrintingLabel] = useState(false);
  const [actionNotice, setActionNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const load = useCallback(() => {
    api<OrderDetail>(`/api/v1/orders/${orderId}`)
      .then((res) => setOrder(res))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [orderId]);

  useEffect(() => {
    load();
    const handleSync = () => load();
    window.addEventListener('shopee:synced', handleSync);
    return () => window.removeEventListener('shopee:synced', handleSync);
  }, [load]);

  const copyOrderSn = () => {
    if (!order) return;
    navigator.clipboard.writeText(order.externalOrderId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
 // Cetak label RESMI Shopee. File diambil dari Shopee lalu dibuka di tab baru.
 // Tidak ada label buatan: kalau Shopee belum bisa, tampilkan pesan aslinya.
 async function handlePrintLabel() {
  if (!order) return;
  setPrintingLabel(true);
  setActionNotice(null);
  try {
   await openOfficialLabel(order.id);
  } catch (err) {
   setActionNotice({
    tone: 'danger',
    text: `Label resmi belum bisa dicetak: ${(err as Error).message}`,
   });
  } finally {
   setPrintingLabel(false);
  }
 }


  async function handleArrangeShipment() {
    if (!order) return;
    setArranging(true);
    setActionNotice(null);
    try {
      const res = await api<{ success: boolean; trackingNumber: string | null; message: string }>(
        `/api/v1/orders/${order.id}/prepare-shipment`,
        { method: 'POST', body: {} },
      );
      setActionNotice({ tone: res.success ? 'success' : 'danger', text: res.message });
      load();
    } catch (err) {
      setActionNotice({ tone: 'danger', text: (err as Error).message });
    } finally {
      setArranging(false);
    }
  }

  if (loading) return <LoadingState message="Memuat detail pesanan..." />;
  if (error || !order) return <ErrorState message={error || 'Pesanan tidak ditemukan'} onRetry={load} />;

  const rawAddr = (order.shippingAddress as Record<string, unknown>) || {};
  const formattedAddress =
    typeof rawAddr === 'string'
      ? rawAddr
      : [
          rawAddr.address || rawAddr.street,
          rawAddr.district,
          rawAddr.city,
          rawAddr.state || rawAddr.province,
          rawAddr.postal_code || rawAddr.postalCode,
        ]
          .filter(Boolean)
          .join(', ');

  const activeShipment = order.shipments[0];
  const awb = order.awb || activeShipment?.awb;
  const carrier = order.carrier || activeShipment?.carrier || (order.provider === 'shopee' ? 'SPX Express' : 'Kurir Reguler');

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 40 }}>
      {/* Back button & Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => router.push('/dashboard/pesanan')}
          className="btn btn-secondary btn-sm"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <ArrowLeft size={14} />
          <span>Kembali ke Pesanan</span>
        </button>
        <span className="muted" style={{ fontSize: 13 }}>/ Detail Pesanan</span>
      </div>

      {actionNotice && (
        <div style={{ marginBottom: 16 }}>
          <Alert tone={actionNotice.tone}>{actionNotice.text}</Alert>
        </div>
      )}

      {/* Main Header */}
      <div
        style={{
          background: 'var(--surface-container, #ffffff)',
          border: '1px solid var(--outline-variant, #e5e7eb)',
          borderRadius: 12,
          padding: 24,
          marginBottom: 20,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 20, fontWeight: 800 }}>Pesanan {order.externalOrderId}</span>
            <button
              type="button"
              onClick={copyOrderSn}
              className="btn btn-ghost btn-sm"
              title="Salin No. Pesanan"
              style={{ padding: '2px 6px' }}
            >
              {copied ? <Check size={14} color="var(--success, #10b981)" /> : <Copy size={14} />}
            </button>
            <StatusBadge status={order.status} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 13, color: 'var(--muted)' }}>
            <span>Toko: <strong style={{ color: 'var(--on-surface)' }}>{order.shopName}</strong></span>
            <span>Marketplace: <strong style={{ textTransform: 'capitalize', color: 'var(--on-surface)' }}>{order.provider}</strong></span>
            <span>Dibuat: {formatDate(order.placedAt)}</span>
          </div>
        </div>

        {/* Top Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* Cetak Label RESMI Shopee (hanya kalau resi sudah ada) */}
          {awb ? (
            <button
              type="button"
              onClick={handlePrintLabel}
              disabled={printingLabel}
              className="btn btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Printer size={15} />
              <span>{printingLabel ? 'Menyiapkan label dari Shopee…' : 'Cetak Label Resi'}</span>
            </button>
          ) : (
            <span className="small muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Printer size={15} />
              <span>Label resmi Shopee muncul setelah nomor resi terbit</span>
            </span>
          )}

          {/* Atur Pengiriman Button */}
          {!awb && (
            <button
              type="button"
              onClick={handleArrangeShipment}
              disabled={arranging}
              className="btn btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Truck size={15} />
              <span>{arranging ? 'Memproses...' : 'Ambil Resi dari Shopee'}</span>
            </button>
          )}

          {/* Kembali ke daftar kerja */}
          <Link
            href="/dashboard/pesanan"
            className="btn btn-secondary"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <ScanLine size={15} />
            <span>Daftar Pesanan</span>
          </Link>
        </div>
      </div>

      {/* 3-Column Info Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 20 }}>
        {/* Card 1: Penerima & Alamat */}
        <div
          style={{
            background: 'var(--surface-container, #ffffff)',
            border: '1px solid var(--outline-variant, #e5e7eb)',
            borderRadius: 12,
            padding: 18,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontWeight: 700, fontSize: 14 }}>
            <User size={16} color="var(--primary, #0284c7)" />
            <span>Informasi Pembeli</span>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            <div><strong>Nama:</strong> {order.buyerName || 'Pembeli Shopee'}</div>
            <div><strong>Telepon:</strong> {order.buyerPhone || '—'}</div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
              <MapPin size={16} style={{ flexShrink: 0, marginTop: 2, color: 'var(--muted)' }} />
              <div>
                <strong>Alamat Pengiriman:</strong>
                <div style={{ color: 'var(--muted)', marginTop: 2 }}>{formattedAddress || '—'}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Card 2: Logistik & Resi */}
        <div
          style={{
            background: 'var(--surface-container, #ffffff)',
            border: '1px solid var(--outline-variant, #e5e7eb)',
            borderRadius: 12,
            padding: 18,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontWeight: 700, fontSize: 14 }}>
            <Truck size={16} color="var(--primary, #0284c7)" />
            <span>Pengiriman & Resi</span>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            <div><strong>Kurir:</strong> {carrier}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <strong>Nomor Resi (AWB):</strong>
              {awb ? (
                <span className="mono" style={{ fontWeight: 800, color: 'var(--primary, #0284c7)', fontSize: 14 }}>
                  {awb}
                </span>
              ) : (
                <span className="badge badge-warning" style={{ fontSize: 11 }}>Belum Terbit</span>
              )}
            </div>
            <div><strong>Batas Pengiriman:</strong> {formatDate(order.shipByAt)}</div>
            {awb && (
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  onClick={handlePrintLabel}
                  disabled={printingLabel}
                  className="btn btn-secondary btn-sm"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <ExternalLink size={13} />
                  <span>{printingLabel ? 'Menyiapkan label…' : 'Lihat / Cetak Label Resi'}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Card 3: Fulfillment & Gudang */}
        <div
          style={{
            background: 'var(--surface-container, #ffffff)',
            border: '1px solid var(--outline-variant, #e5e7eb)',
            borderRadius: 12,
            padding: 18,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontWeight: 700, fontSize: 14 }}>
            <Package size={16} color="var(--primary, #0284c7)" />
            <span>Proses Kirim</span>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            {order.fulfillmentOrders.length > 0 ? (
              order.fulfillmentOrders.map((fo) => (
                <div key={fo.id} style={{ marginBottom: 6 }}>
                  <div><strong>Gudang:</strong> {fo.warehouseName}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                    <strong>Status Proses:</strong>
                    <StatusBadge status={fo.status} />
                  </div>
                </div>
              ))
            ) : (
              <div className="muted">Belum ada antrian fulfillment aktif untuk pesanan ini.</div>
            )}
          </div>
        </div>
      </div>

      {/* Items Table */}
      <div
        style={{
          background: 'var(--surface-container, #ffffff)',
          border: '1px solid var(--outline-variant, #e5e7eb)',
          borderRadius: 12,
          padding: 20,
          marginBottom: 20,
        }}
      >
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Daftar Produk Dipesan</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Produk</th>
                <th>SKU</th>
                <th>Barcode</th>
                <th className="num">Jumlah</th>
                <th className="num">Terpenuhi</th>
                <th>Status Stok</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((it) => (
                <tr key={it.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{it.productName}</div>
                    {it.variantName && <div className="small muted">Varian: {it.variantName}</div>}
                  </td>
                  <td><code className="mono">{it.sku}</code></td>
                  <td><code className="mono">{it.barcode || '—'}</code></td>
                  <td className="num"><strong>{it.quantity}</strong></td>
                  <td className="num">{it.fulfilledQuantity} / {it.quantity}</td>
                  <td>
                    {it.isReserved ? (
                      <span className="badge badge-success" style={{ fontSize: 11 }}>Stok Dialokasikan</span>
                    ) : (
                      <span className="badge badge-warning" style={{ fontSize: 11 }}>Menunggu Stok</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Rincian Biaya & Pembayaran */}
      <div className="card mb20">
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Rincian Biaya &amp; Pembayaran</h3>
        {order.totalAmount === null &&
        order.itemSubtotal === null &&
        order.buyerShippingFee === null &&
        order.escrowAmount === null ? (
          <p className="small muted" style={{ margin: 0, lineHeight: 1.6 }}>
            Shopee belum mengirim rincian biaya untuk pesanan ini. Rincian biasanya terisi setelah pesanan
            dibayar / diproses — sistem akan mengisinya sendiri pada sinkronisasi berikutnya (tidak ada angka
            yang kami karang).
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <tbody>
                <tr>
                  <td>Harga barang (sebelum diskon)</td>
                  <td className="num">{formatRupiah(order.itemSubtotal)}</td>
                </tr>
                <tr>
                  <td>Diskon dari toko Anda</td>
                  <td className="num">-{formatRupiah(order.sellerDiscount)}</td>
                </tr>
                <tr>
                  <td>Diskon dari Shopee</td>
                  <td className="num">-{formatRupiah(order.shopeeDiscount)}</td>
                </tr>
                <tr>
                  <td>Ongkos kirim dibayar pembeli</td>
                  <td className="num">{formatRupiah(order.buyerShippingFee)}</td>
                </tr>
                <tr>
                  <td>Potongan ongkir (gratis ongkir / subsidi)</td>
                  <td className="num">-{formatRupiah(order.shippingFeeDiscount)}</td>
                </tr>
                <tr style={{ fontWeight: 700 }}>
                  <td>Total dibayar pembeli</td>
                  <td className="num">{formatRupiah(order.totalAmount)}</td>
                </tr>
                <tr>
                  <td>Potongan Shopee (komisi + biaya layanan)</td>
                  <td className="num" style={{ color: 'var(--danger, #ef4444)' }}>
                    {order.platformFee !== null ? `-${formatRupiah(order.platformFee)}` : '-'}
                  </td>
                </tr>
                <tr style={{ fontWeight: 700 }}>
                  <td>Estimasi dana masuk ke Anda</td>
                  <td className="num" style={{ color: 'var(--success, #10b981)' }}>
                    {order.escrowAmount !== null ? formatRupiah(order.escrowAmount) : 'Belum dihitung Shopee'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: 12, display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 13 }}>
          <div>
            <span className="muted">Metode pembayaran: </span>
            <strong>{order.isCod ? 'COD (bayar di tempat)' : (order.paymentMethod ?? 'Belum diketahui')}</strong>
          </div>
          <div>
            <span className="muted">Waktu pembayaran: </span>
            <strong>{order.paidAt ? formatDate(order.paidAt) : 'Belum dibayar'}</strong>
          </div>
          {order.packageNumber ? (
            <div>
              <span className="muted">Nomor paket: </span>
              <strong className="mono">{order.packageNumber}</strong>
            </div>
          ) : null}
        </div>

        {order.buyerNote ? (
          <div style={{ marginTop: 12 }}>
            <Alert tone="info">Catatan dari pembeli: {order.buyerNote}</Alert>
          </div>
        ) : null}
      </div>

      {/* Status History Timeline */}
      <div
        style={{
          background: 'var(--surface-container, #ffffff)',
          border: '1px solid var(--outline-variant, #e5e7eb)',
          borderRadius: 12,
          padding: 20,
        }}
      >
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Riwayat Status Pesanan</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {order.statusHistory.map((h, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: 'var(--primary-container, #e0f2fe)',
                  color: 'var(--primary, #0284c7)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginTop: 2,
                }}
              >
                <CheckCircle2 size={14} />
              </div>
              <div style={{ flexGrow: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <StatusBadge status={h.toStatus} />
                  <span className="small muted">{formatDate(h.createdAt)}</span>
                </div>
                {h.reason && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{h.reason}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
