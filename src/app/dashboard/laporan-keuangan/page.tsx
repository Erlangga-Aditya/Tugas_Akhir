'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Download, RefreshCw, TrendingUp, Wallet } from 'lucide-react';
import { api, formatDate, formatRupiah } from '@/lib/api';
import { Alert, EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '@/components/ui';

/**
 * Laporan Keuangan.
 *
 * Angka diambil dari rincian uang yang dikirim Shopee pada setiap pesanan
 * (total dibayar pembeli, ongkir, diskon, potongan Shopee, estimasi dana masuk).
 * Pesanan yang belum punya rincian tetap ditampilkan dan dihitung terpisah,
 * supaya tidak ada angka yang diam-diam dianggap nol.
 */

interface FinanceOrderRow {
  id: string;
  externalOrderId: string;
  placedAt: string;
  status: string;
  buyerName: string | null;
  shopName: string;
  paymentMethod: string | null;
  isCod: boolean;
  currency: string | null;
  totalAmount: number | null;
  itemSubtotal: number | null;
  sellerDiscount: number | null;
  shopeeDiscount: number | null;
  buyerShippingFee: number | null;
  shippingFeeDiscount: number | null;
  platformFee: number | null;
  escrowAmount: number | null;
  hasMoneyDetail: boolean;
}

interface FinanceReport {
  range: { from: string; to: string };
  totals: {
    orderCount: number;
    ordersWithDetail: number;
    grossSales: number;
    sellerDiscount: number;
    shopeeDiscount: number;
    buyerShippingFee: number;
    shippingFeeDiscount: number;
    platformFee: number;
    buyerPaid: number;
    estimatedPayout: number;
    codCount: number;
  };
  daily: Array<{ date: string; orderCount: number; buyerPaid: number; estimatedPayout: number }>;
  byPaymentMethod: Array<{ method: string; orderCount: number; buyerPaid: number }>;
  orders: FinanceOrderRow[];
}

function toInputDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function LaporanKeuanganPage() {
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(() => toInputDate(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(() => toInputDate(today));
  const [report, setReport] = useState<FinanceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pulling, setPulling] = useState(false);

  const load = useCallback(async (fromDate: string, toDate: string) => {
    try {
      const res = await api<FinanceReport>(
        `/api/v1/reports/finance?from=${fromDate}&to=${toDate}`,
      );
      setReport(res);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      await load(from, to);
    })();
    const onRealtime = () => void load(from, to);
    window.addEventListener('shopee:synced', onRealtime);
    return () => {
      cancelled = true;
      window.removeEventListener('shopee:synced', onRealtime);
    };
  }, [load, from, to]);

  /**
   * Satu helper untuk semua preset rentang, supaya tidak ada logika tanggal
   * yang ditulis ulang berkali-kali (sumber bug "tombol ini beda hasilnya").
   */
  function setRentang(hariLalu: number) {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - (hariLalu - 1));
    const startStr = toInputDate(start);
    const endStr = toInputDate(now);
    setFrom(startStr);
    setTo(endStr);
    setLoading(true);
    void load(startStr, endStr);
  }

  function pilihBulanIni() {
    const now = new Date();
    const start = toInputDate(new Date(now.getFullYear(), now.getMonth(), 1));
    const end = toInputDate(now);
    setFrom(start);
    setTo(end);
    setLoading(true);
    void load(start, end);
  }

  function pilih30Hari() {
    setRentang(30);
  }

  /** Minta Shopee mengirim rincian biaya (komisi, biaya layanan, dana dilepas) untuk pesanan terkini. */
  async function tarikRincianBiaya() {
    setPulling(true);
    setNotice('');
    try {
      const res = await api<{ requested: number; updated: number; message: string }>(
        '/api/v1/integrations/shopee/sync-escrow',
        { method: 'POST', body: { limit: 50 } },
      );
      setNotice(res.message);
      await load(from, to);
    } catch (e) {
      setNotice(`Gagal menarik rincian biaya: ${(e as Error).message}`);
    } finally {
      setPulling(false);
    }
  }

  function unduhCsv() {
    if (!report) return;
    const header = [
      'Tanggal',
      'No Pesanan',
      'Toko',
      'Pembeli',
      'Metode Bayar',
      'Harga Barang',
      'Diskon Toko',
      'Diskon Shopee',
      'Ongkir Dibayar Pembeli',
      'Potongan Ongkir',
      'Potongan Shopee',
      'Total Dibayar Pembeli',
      'Estimasi Dana Masuk',
      'Ada Rincian',
    ];
    const lines = report.orders.map((o) =>
      [
        formatDate(o.placedAt),
        o.externalOrderId,
        o.shopName,
        o.buyerName ?? '-',
        o.isCod ? 'COD' : (o.paymentMethod ?? '-'),
        o.itemSubtotal ?? '',
        o.sellerDiscount ?? '',
        o.shopeeDiscount ?? '',
        o.buyerShippingFee ?? '',
        o.shippingFeeDiscount ?? '',
        o.platformFee ?? '',
        o.totalAmount ?? '',
        o.escrowAmount ?? '',
        o.hasMoneyDetail ? 'ya' : 'belum',
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `laporan-keuangan-${from}-sd-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <LoadingState message="Menghitung laporan keuangan..." />;
  if (error) {
    return <ErrorState message={error} onRetry={() => { setLoading(true); void load(from, to); }} />;
  }

  const t = report?.totals;
  const belumAdaRincian = (t?.orderCount ?? 0) - (t?.ordersWithDetail ?? 0);

  return (
    <div style={{ paddingBottom: 60 }}>
      <PageHeader
        title="Laporan Keuangan"
        subtitle="Uang masuk dari pesanan: harga barang, ongkir, potongan, dan estimasi dana yang diterima"
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={pulling}
              title="Minta Shopee mengirim rincian komisi, biaya layanan, dan dana yang dilepas"
              onClick={() => void tarikRincianBiaya()}
            >
              <RefreshCw size={14} aria-hidden />
              <span>{pulling ? 'Menarik data...' : 'Tarik Rincian Biaya'}</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setLoading(true);
                void load(from, to);
              }}
            >
              <RefreshCw size={14} aria-hidden />
              <span>Muat Ulang</span>
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={unduhCsv} disabled={!report}>
              <Download size={14} aria-hidden />
              <span>Unduh Excel/CSV</span>
            </button>
          </div>
        }
      />

      {notice && (
        <div className="mb16">
          <Alert tone="info">{notice}</Alert>
        </div>
      )}

      <div className="card mb20">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ width: 170 }}>
            <label style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 6 }}>Dari tanggal</label>
            <input
              type="date"
              className="input"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setLoading(true);
                void load(e.target.value, to);
              }}
            />
          </div>
          <div style={{ width: 170 }}>
            <label style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 6 }}>Sampai tanggal</label>
            <input
              type="date"
              className="input"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setLoading(true);
                void load(from, e.target.value);
              }}
            />
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={pilihBulanIni}>
            <span>Bulan ini</span>
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRentang(7)}>
            <span>7 hari terakhir</span>
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={pilih30Hari}>
            <span>30 hari terakhir</span>
          </button>
        </div>
      </div>

      <div className="stat-grid mb20">
        <div className="card">
          <div className="small muted">Total dibayar pembeli</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{formatRupiah(t?.buyerPaid ?? 0)}</div>
          <div className="small muted">dari {t?.orderCount ?? 0} pesanan</div>
        </div>
        <div className="card">
          <div className="small muted">Estimasi dana masuk</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--success, #10b981)' }}>
            {formatRupiah(t?.estimatedPayout ?? 0)}
          </div>
          <div className="small muted">setelah potongan Shopee</div>
        </div>
        <div className="card">
          <div className="small muted">Harga barang (sebelum diskon)</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{formatRupiah(t?.grossSales ?? 0)}</div>
        </div>
        <div className="card">
          <div className="small muted">Ongkir dibayar pembeli</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{formatRupiah(t?.buyerShippingFee ?? 0)}</div>
        </div>
        <div className="card">
          <div className="small muted">Potongan Shopee (komisi &amp; layanan)</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--danger, #ef4444)' }}>
            -{formatRupiah(t?.platformFee ?? 0)}
          </div>
        </div>
        <div className="card">
          <div className="small muted">Diskon dari Anda (toko)</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>-{formatRupiah(t?.sellerDiscount ?? 0)}</div>
        </div>
      </div>

      {belumAdaRincian > 0 && (
        <div className="mb16">
          <Alert tone="warning">
            {belumAdaRincian} dari {t?.orderCount ?? 0} pesanan belum punya rincian biaya dari Shopee (biasanya
            muncul setelah pesanan diproses/dibayar). Angka di atas hanya menghitung pesanan yang sudah ada
            rinciannya — jadi tidak ada nilai yang dianggap nol tanpa keterangan.
          </Alert>
        </div>
      )}

      <div className="card mb20">
        <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Wallet size={17} aria-hidden />
          <span>Rincian per Pesanan</span>
        </h2>
        {!report || report.orders.length === 0 ? (
          <EmptyState
            title="Belum ada pesanan pada rentang tanggal ini"
            description="Ubah rentang tanggal, atau tunggu pesanan baru masuk dari Shopee."
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Pesanan</th>
                  <th>Pembeli</th>
                  <th>Metode</th>
                  <th className="num">Harga barang</th>
                  <th className="num">Ongkir</th>
                  <th className="num">Diskon</th>
                  <th className="num">Potongan Shopee</th>
                  <th className="num">Dibayar pembeli</th>
                  <th className="num">Estimasi masuk</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {report.orders.map((o) => (
                  <tr key={o.id}>
                    <td className="small">{formatDate(o.placedAt)}</td>
                    <td>
                      <Link href={`/dashboard/pesanan/${o.id}`} className="mono" style={{ fontSize: 12 }}>
                        {o.externalOrderId}
                      </Link>
                    </td>
                    <td className="small">{o.buyerName ?? '-'}</td>
                    <td className="small">{o.isCod ? 'COD' : (o.paymentMethod ?? '-')}</td>
                    <td className="num">{o.hasMoneyDetail ? formatRupiah(o.itemSubtotal) : '-'}</td>
                    <td className="num">{o.hasMoneyDetail ? formatRupiah(o.buyerShippingFee) : '-'}</td>
                    <td className="num">
                      {o.hasMoneyDetail
                        ? formatRupiah(-((o.sellerDiscount ?? 0) + (o.shopeeDiscount ?? 0)))
                        : '-'}
                    </td>
                    <td className="num">
                      {o.platformFee !== null ? formatRupiah(-o.platformFee) : '-'}
                    </td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {o.hasMoneyDetail ? formatRupiah(o.totalAmount) : '-'}
                    </td>
                    <td className="num" style={{ fontWeight: 700, color: 'var(--success, #10b981)' }}>
                      {o.escrowAmount !== null ? formatRupiah(o.escrowAmount) : '-'}
                    </td>
                    <td>
                      <StatusBadge status={o.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <div className="card">
          <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <TrendingUp size={16} aria-hidden />
            <span>Per Hari</span>
          </h2>
          {report && report.daily.length > 0 ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Tanggal</th>
                    <th className="num">Pesanan</th>
                    <th className="num">Dibayar pembeli</th>
                    <th className="num">Estimasi masuk</th>
                  </tr>
                </thead>
                <tbody>
                  {report.daily.map((d) => (
                    <tr key={d.date}>
                      <td className="small">{d.date}</td>
                      <td className="num">{d.orderCount}</td>
                      <td className="num">{formatRupiah(d.buyerPaid)}</td>
                      <td className="num">{formatRupiah(d.estimatedPayout)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="small muted">Belum ada data.</p>
          )}
        </div>

        <div className="card">
          <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 12 }}>
            Metode Pembayaran
          </h2>
          {report && report.byPaymentMethod.length > 0 ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Metode</th>
                    <th className="num">Pesanan</th>
                    <th className="num">Dibayar pembeli</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byPaymentMethod.map((m) => (
                    <tr key={m.method}>
                      <td className="small">{m.method}</td>
                      <td className="num">{m.orderCount}</td>
                      <td className="num">{formatRupiah(m.buyerPaid)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="small muted">Belum ada data.</p>
          )}
        </div>
      </div>
    </div>
  );
}
