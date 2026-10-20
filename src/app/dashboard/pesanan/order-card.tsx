'use client';

import Link from 'next/link';
import {
  Boxes,
  ClipboardList,
  Handshake,
  Info,
  Package,
  PackageCheck,
  Plus,
  Printer,
  ScanLine,
  Truck,
  TruckIcon,
} from 'lucide-react';
import { Alert } from '@/components/ui';
import { formatDate } from '@/lib/api';
import { STAGE_LABEL, STAGE_TONE, type OrderItemRow, type StationOrder } from './types';
import {
  CANCEL_CATEGORY_LABEL,
  LATE_RISK_LABEL,
  type CancelCategory,
  type LateRisk,
} from '@/modules/fulfillment/domain/order-exceptions';

/** Nada badge untuk risiko keterlambatan (hanya yang perlu perhatian). */
function nadaRisiko(risk: LateRisk): string | null {
  switch (risk) {
    case 'TERLAMBAT':
      return 'badge-danger';
    case 'BESOK_BATAL':
      return 'badge-warning';
    case 'BERESIKO':
      return 'badge-secondary';
    default:
      return null;
  }
}

/** Nada badge untuk kategori pembatalan. */
function nadaPembatalan(kategori: CancelCategory): string {
  return kategori === 'DIAJUKAN' ? 'badge-warning' : 'badge-neutral';
}

/**
 * Satu kartu pesanan.
 *
 * Aturan penting: SEMUA tombol di sini berasal dari `order.workflow` yang
 * dihitung server. Tidak ada lagi syarat `!awb` atau `stage === ...` yang
 * ditulis ulang di sini — itulah yang dulu memunculkan tombol "Ambil Resi"
 * pada pesanan batal dan pesanan yang sudah diterima pembeli.
 */

function ItemTable({
  items,
  onAddStock,
}: {
  items: OrderItemRow[];
  onAddStock?: (item: OrderItemRow) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Produk</th>
            <th>Kode (SKU)</th>
            <th className="num">Jumlah</th>
            <th className="num">Stok gudang</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id}>
              <td>
                <div style={{ fontWeight: 600 }}>{it.productName}</div>
                {it.variantName && it.variantName !== it.productName ? (
                  <div className="small muted">Varian: {it.variantName}</div>
                ) : null}
              </td>
              <td>
                <code className="mono">{it.sku}</code>
              </td>
              <td className="num">{it.quantity}</td>
              <td className="num">
                {it.shortfall > 0 ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--danger)', fontWeight: 700 }}>
                      {it.available} (kurang {it.shortfall})
                    </span>
                    {onAddStock && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => onAddStock(it)}>
                        <Plus size={12} aria-hidden />
                        <span>Tambah stok</span>
                      </button>
                    )}
                  </span>
                ) : (
                  <span style={{ color: 'var(--success)', fontWeight: 600 }}>{it.available}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Badge keadaan paket: ikon, bukan emoji, supaya tampil sama di semua perangkat. */
function ShipmentBadge({ order }: { order: StationOrder }) {
  const s = order.shipmentStatus;
  if (s === 'IN_TRANSIT') {
    return (
      <span className="badge badge-info">
        <Truck size={11} aria-hidden /> Di perjalanan
      </span>
    );
  }
  if (s === 'DELIVERED') {
    return (
      <span className="badge badge-success">
        <PackageCheck size={11} aria-hidden /> Diterima pembeli
      </span>
    );
  }
  if (s === 'PICKED_UP') {
    return (
      <span className="badge badge-secondary">
        <TruckIcon size={11} aria-hidden /> Diambil kurir
      </span>
    );
  }
  if (s === 'FAILED') {
    return (
      <span className="badge badge-danger">
        <Info size={11} aria-hidden /> Gagal kirim
      </span>
    );
  }
  if (s === 'READY_TO_SHIP' && order.workflow.nextAction === 'HANDOVER') {
    return (
      <span className="badge badge-warning">
        <Package size={11} aria-hidden /> Menunggu dijemput
      </span>
    );
  }
  return null;
}

export interface OrderCardProps {
  order: StationOrder;
  now: Date | null;
  picked: boolean;
  busyKey: string | null;
  printingLabelId: string | null;
  /** false = pesanan final (batal / sudah diterima / sudah dikirim), tidak boleh dicentang. */
  selectable: boolean;
  onTogglePick: () => void;
  onAmbilResi: () => void;
  onProses: () => void;
  onHandover: () => void;
  onFocusScanner: () => void;
  onPrintLabel: () => void;
  onAddStock: (variantId: string | null) => void;
}

export function OrderCard({
  order: o,
  now,
  picked,
  busyKey,
  printingLabelId,
  selectable,
  onTogglePick,
  onAmbilResi,
  onProses,
  onHandover,
  onFocusScanner,
  onPrintLabel,
  onAddStock,
}: OrderCardProps) {
  const w = o.workflow;
  const hoursLeft =
    o.shipByAt && now ? Math.round((new Date(o.shipByAt).getTime() - now.getTime()) / 3600000) : null;
  const urgent = hoursLeft !== null && hoursLeft <= 24 && !w.isFinal;
  const tone = STAGE_TONE[o.stage];

  return (
    <div className="card" style={{ borderLeft: `3px solid ${tone}` }}>
      <div className="order-card-head">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0 }}>
          <label
            title={selectable ? 'Centang untuk diproses sekaligus' : 'Pesanan ini sudah final — tidak perlu diproses lagi'}
            style={{ display: 'flex', alignItems: 'center', cursor: selectable ? 'pointer' : 'not-allowed', paddingTop: 2 }}
          >
            <input
              type="checkbox"
              checked={picked}
              onChange={onTogglePick}
              disabled={!selectable}
              aria-label={`Pilih pesanan ${o.externalOrderId}`}
            />
          </label>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="mono" style={{ fontWeight: 700 }}>{o.externalOrderId}</span>
              <span className="badge badge-neutral">{STAGE_LABEL[o.stage]}</span>
              <ShipmentBadge order={o} />
              {o.awb ? (
                <span className="badge badge-neutral mono" style={{ fontSize: 11 }}>{o.awb}</span>
              ) : (
                <span className="badge badge-neutral" style={{ fontSize: 11 }}>Resi belum ada</span>
              )}
              {o.lateRisk !== 'TIDAK_RELEVAN' && nadaRisiko(o.lateRisk) && (
                <span className={`badge ${nadaRisiko(o.lateRisk)}`} style={{ fontSize: 11 }}>
                  {LATE_RISK_LABEL[o.lateRisk]}
                </span>
              )}
              {o.cancelCategory && (
                <span className={`badge ${nadaPembatalan(o.cancelCategory)}`} style={{ fontSize: 11 }}>
                  {CANCEL_CATEGORY_LABEL[o.cancelCategory]}
                </span>
              )}
              {urgent && hoursLeft !== null && (
                <span className="badge badge-danger" style={{ fontSize: 11 }}>
                  {hoursLeft < 0 ? `Lewat ${Math.abs(hoursLeft)} jam` : `Sisa ${hoursLeft} jam`}
                </span>
              )}
            </div>
            <div className="small muted" style={{ marginTop: 4 }}>
              {o.buyerName ?? 'Pembeli Shopee'} · {o.shopName} · masuk {formatDate(o.placedAt)} · batas kirim{' '}
              {formatDate(o.shipByAt)} · {o.totalUnits} barang
            </div>
            {o.cancelCategory && (
              <div className="small" style={{ marginTop: 4 }}>
                {o.cancelCategory === 'DIAJUKAN' ? (
                  <>
                    <strong>Pembatalan diajukan</strong>
                    {o.buyerCancelReason || o.cancelReason ? `: ${o.buyerCancelReason ?? o.cancelReason}` : ''}
                    {o.cancelRequestedAt ? ` · diajukan ${formatDate(o.cancelRequestedAt)}` : ''}
                    {' · '}
                    <a
                      href={`https://seller.shopee.co.id/portal/sale/order/${o.externalOrderId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Tanggapi di Seller Centre
                    </a>
                  </>
                ) : (
                  <>
                    <strong>{CANCEL_CATEGORY_LABEL[o.cancelCategory]}</strong>
                    {o.cancelReason ? `: ${o.cancelReason}` : ''}
                    {o.cancelledAt ? ` · ${formatDate(o.cancelledAt)}` : ''}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {w.nextAction === 'ARRANGE_SHIPMENT' && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busyKey === `resi-${o.orderId}`}
              title="Minta nomor resi ke Shopee supaya paket bisa lanjut ke tahap pemrosesan"
              onClick={onAmbilResi}
            >
              <Truck size={13} aria-hidden />
              <span>{busyKey === `resi-${o.orderId}` ? 'Memproses...' : 'Ambil Resi dari Shopee'}</span>
            </button>
          )}

          {w.nextAction === 'PROCESS_ORDER' && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busyKey === `siap-${o.orderId}`}
              onClick={onProses}
            >
              <ClipboardList size={13} aria-hidden />
              <span>{busyKey === `siap-${o.orderId}` ? 'Memproses...' : 'Mulai Proses Pesanan'}</span>
            </button>
          )}

          {w.nextAction === 'ADD_STOCK' && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => onAddStock(o.items.find((i) => i.shortfall > 0)?.variantId ?? null)}
            >
              <Boxes size={13} aria-hidden />
              <span>Isi Stok dulu</span>
            </button>
          )}

          {w.nextAction === 'SCAN_AWB' && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              title="Kembalikan fokus ke pemindai; operator tetap harus memindai barcode resi"
              onClick={onFocusScanner}
            >
              <ScanLine size={13} aria-hidden />
              <span>Scan Resi untuk Selesai</span>
            </button>
          )}

          {w.nextAction === 'HANDOVER' && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busyKey === `serah-${o.orderId}`}
              onClick={onHandover}
            >
              <Handshake size={13} aria-hidden />
              <span>{busyKey === `serah-${o.orderId}` ? 'Memproses...' : 'Serahkan ke Kurir'}</span>
            </button>
          )}

          {w.canPrintLabel && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={printingLabelId === o.orderId}
              onClick={onPrintLabel}
            >
              <Printer size={13} aria-hidden />
              <span>{printingLabelId === o.orderId ? 'Menyiapkan label…' : 'Cetak Label Resi'}</span>
            </button>
          )}

          <Link className="btn btn-ghost btn-sm" href={`/dashboard/pesanan/${o.orderId}`}>
            <Info size={13} aria-hidden />
            <span>Detail</span>
          </Link>
        </div>
      </div>

      {w.canArrangeShipment && (
        <div style={{ marginBottom: 10 }}>
          <Alert tone="info">
            Nomor resi belum ada. Klik <strong>Ambil Resi dari Shopee</strong> supaya Shopee menerbitkan nomor resi,
            baru paket bisa dinyatakan siap kirim.
          </Alert>
        </div>
      )}

      {w.canAddStock && o.shortfallUnits > 0 && (
        <div style={{ marginBottom: 10 }}>
          <Alert tone="warning">
            Stok gudang kurang {o.shortfallUnits} barang untuk pesanan ini. Tambah stok dulu, atau pilih
            &quot;Tetap kirim (stok jadi minus)&quot; setelah memindai resi.
          </Alert>
        </div>
      )}

      <ItemTable
        items={o.items}
        onAddStock={
          w.canAddStock
            ? (item) => onAddStock(item.variantId)
            : undefined
        }
      />
    </div>
  );
}
