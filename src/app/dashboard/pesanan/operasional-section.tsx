'use client';

/**
 * Ringkasan operasional — ditampilkan di halaman Pesanan (bukan Laporan).
 *
 * Dipisah dari dashboard untuk menghindari overload kartu. Hanya tampil bila
 * user punya izin `page.reports`.
 *
 * Dua kelompok angka yang sengaja dipisah:
 *   1. Keadaan SEKARANG (dari status fulfillment saat ini, tanpa saringan tanggal).
 *   2. Kejadian DALAM RENTANG (yang benar-benar dipacking/diserahkan pada hari yang dipilih).
 */
import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Package,
  Truck,
} from 'lucide-react';
import { api } from '@/lib/api';
import { usePermission } from '@/hooks/usePermission';
import {
  RANGE_LABEL,
  RANGE_PRESETS,
  type RangePreset,
} from '@/modules/fulfillment/domain/date-range';
import { hitungTahap, TAHAP_OPERASIONAL } from '@/modules/reports/domain/operation-metrics';

// ── Tipe data ────────────────────────────────────────────────────────────────

interface OperasionalData {
  preset: RangePreset;
  /** Tahapan kerja gudang saat ini. */
  tahap: ReturnType<typeof hitungTahap>;
  /** Kejadian dipacking / diserahkan / diterima kurir dalam rentang terpilih. */
  kejadian: {
    dipacking: number;
    diserahkan: number;
    diterimaKurirShopee: number;
  };
}

// ── Kartu statistik ─────────────────────────────────────────────────────────

interface KartuDefinisi {
  key: string;
  label: string;
  hint: string;
  nilai: number;
  warna: string;
  ikon: React.ElementType;
}

/** Warna border per fase kerja. */
const WARNA = {
  produksi: 'var(--tertiary)',
  ambil: 'var(--info)',
  packing: 'var(--primary)',
  serah: 'var(--primary-solid)',
  gagal: 'var(--danger)',
  selesai: 'var(--success)',
};

function buatKartuKeadaan(t: ReturnType<typeof hitungTahap>): KartuDefinisi[] {
  return [
    {
      key: 'perluProduksi',
      label: TAHAP_OPERASIONAL.perluProduksi,
      hint: 'Belum ada stok — butuh produksi dulu',
      nilai: t.perluProduksi,
      warna: WARNA.produksi,
      ikon: Boxes,
    },
    {
      key: 'siapDiambil',
      label: TAHAP_OPERASIONAL.siapDiambil,
      hint: 'Stok cukup, menunggu picker mengambil barang',
      nilai: t.siapDiambil,
      warna: WARNA.ambil,
      ikon: ClipboardList,
    },
    {
      key: 'sedangDipacking',
      label: TAHAP_OPERASIONAL.sedangDipacking,
      hint: 'Sedang dikemas / dicek / ditimbang',
      nilai: t.sedangDipacking,
      warna: WARNA.packing,
      ikon: Package,
    },
    {
      key: 'siapDiserahkan',
      label: TAHAP_OPERASIONAL.siapDiserahkan,
      hint: 'Sudah di-pack, menunggu penjemputan kurir',
      nilai: t.siapDiserahkan,
      warna: WARNA.serah,
      ikon: Truck,
    },
    {
      key: 'gagal',
      label: TAHAP_OPERASIONAL.gagal,
      hint: 'Paket bermasalah — perlu penanganan operator',
      nilai: t.gagal,
      warna: WARNA.gagal,
      ikon: AlertTriangle,
    },
  ];
}

// ── Komponen utama ───────────────────────────────────────────────────────────

export function OperasionalSectionPesanan() {
  const { can } = usePermission();

  // Semua hook HARUS dipanggil di urutan yang sama setiap render.
  // Permission check dilakukan SETELAH semua hook agar tidak melanggar rules-of-hooks.
  const [preset, setPreset] = useState<RangePreset>('today');
  const [data, setData] = useState<OperasionalData | null>(null);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState('');

  useEffect(() => {
    let dibatalkan = false;
    void (async () => {
      try {
        const hasil = await api<OperasionalData>(
          `/api/v1/reports/operations?range=${preset}`,
        );
        if (dibatalkan) return;
        setData(hasil);
        setGalat('');
      } catch (e) {
        if (dibatalkan) return;
        setGalat((e as Error).message);
      } finally {
        if (!dibatalkan) setMemuat(false);
      }
    })();
    return () => {
      dibatalkan = true;
    };
  }, [preset]);

  // Gate: tidak ada izin laporan → balik null TETAPI hook sudah dipanggil di atas.
  if (!can('page.reports')) return null;

  const kartuKeadaan = data ? buatKartuKeadaan(data.tahap) : [];

  return (
    <section className="card mb24" aria-label="Ringkasan operasional gudang">
      {/* Judul + filter rentang */}
      <div
        className="queue-card-head"
        style={{ flexWrap: 'wrap', gap: 10, marginBottom: 4 }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
            Ringkasan Operasional Gudang
          </h2>
          <p className="small muted" style={{ margin: '2px 0 0' }}>
            Keadaan sekarang + jumlah paket yang benar-benar dipacking &amp; diserahkan pada rentang tanggal terpilih.
          </p>
        </div>
        <div className="filter-chips-wrap">
          {RANGE_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={`chip${preset === p ? ' chip-active' : ''}`}
              onClick={() => setPreset(p)}
            >
              {RANGE_LABEL[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Loading / Error */}
      {memuat && !data ? (
        <p className="small muted" style={{ padding: 12 }}>
          <Loader2 size={14} className="spin" aria-hidden /> Memuat ringkasan…
        </p>
      ) : galat ? (
        <p className="small" style={{ color: 'var(--danger)', padding: 12 }}>
          Gagal memuat ringkasan: {galat}
        </p>
      ) : data ? (
        <>
          {/* ── Bagian 1: Keadaan SEKARANG ─────────────────────────────── */}
          <div className="stat-grid" style={{ marginTop: 12 }}>
            {kartuKeadaan.map((k) => (
              <div
                key={k.key}
                className="stat-card"
                style={{ borderLeft: `3px solid ${k.warna}` }}
              >
                <div className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <k.ikon size={13} aria-hidden /> {k.label}
                </div>
                <div className="stat-value">{k.nilai}</div>
                <div className="small muted">{k.hint}</div>
              </div>
            ))}
          </div>

          {/* ── Bagian 2: Kejadian DALAM RENTANG ───────────────────────── */}
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--divider)' }}>
            <p className="small muted" style={{ margin: '0 0 10px' }}>
              Paket yang benar-benar dipacking / diserahkan / diterima kurir pada rentang
              {preset === 'today'
                ? ' hari ini'
                : preset === 'yesterday'
                  ? ' kemarin'
                  : preset === 'last7'
                    ? ' 7 hari terakhir'
                    : preset === 'last30'
                      ? ' 30 hari terakhir'
                      : ' semua tanggal'}
              .
            </p>
            <div className="stat-grid">
              <div className="stat-card">
                <div className="small muted">Dipacking (rentang ini)</div>
                <div className="stat-value">{data.kejadian.dipacking}</div>
                <div className="small muted">paket dibungkus &amp; siap kirim</div>
              </div>
              <div className="stat-card">
                <div className="small muted">Diserahkan ke kurir (rentang ini)</div>
                <div className="stat-value">{data.kejadian.diserahkan}</div>
                <div className="small muted">paket diambil pihak kedua (kurir internal / pihak ketiga)</div>
              </div>
              <div className="stat-card">
                <div className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <CheckCircle2 size={13} aria-hidden /> Diterima kurir Shopee
                </div>
                <div className="stat-value">{data.kejadian.diterimaKurirShopee}</div>
                <div className="small muted">paket yang sudah dijemput langsung oleh Shopee</div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
