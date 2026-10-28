'use client';

/**
 * Ringkasan operasional — ditampilkan di halaman Pesanan (bukan Laporan).
 *
 * Ikut satu-satunya filter tanggal halaman (lewat prop) — tidak punya filter
 * sendiri lagi, karena dua filter di satu layar membuat angka sulit dicocokkan.
 * Hanya tampil bila user punya izin `page.reports`.
 *
 * Tiga kelompok angka yang sengaja dipisah:
 *   1. Keadaan SEKARANG (tanpa saringan tanggal) — kartunya DAPAT DIKLIK:
 *      klik = daftar di bawah hanya menampilkan pesanan tahap itu (bukti kartu).
 *   2. Aksi di aplikasi DALAM RENTANG (dipacking / diserahkan lewat layar ini).
 *   3. Kejadian dari Shopee DALAM RENTANG (paket dijemput kurir — pelakunya
 *      bukan operator aplikasi, mis. dikirim lewat Seller Centre).
 */
import { useEffect, useState } from 'react';
import { Boxes, CheckCircle2, ClipboardList, Loader2, Package, PackageCheck, Truck } from 'lucide-react';
import { api } from '@/lib/api';
import { usePermission } from '@/hooks/usePermission';
import { RANGE_LABEL, type RangePreset } from '@/modules/fulfillment/domain/date-range';
import {
  hitungTahap,
  TAHAP_OPERASIONAL,
  type TahapOperasional,
} from '@/modules/reports/domain/operation-metrics';

// ── Tipe data ────────────────────────────────────────────────────────────────

interface OperasionalData {
  preset: RangePreset;
  /** Tahapan kerja gudang saat ini. */
  tahap: ReturnType<typeof hitungTahap>;
  /** Aksi di aplikasi dalam rentang terpilih. */
  kejadian: {
    dipacking: number;
    diserahkan: number;
  };
  /** Kejadian dari Shopee dalam rentang terpilih. */
  kejadianShopee: {
    dijemputKurir: number;
  };
}

interface OperasionalSectionProps {
  /** Rentang tanggal yang sedang dipilih halaman — dipakai bersama. */
  preset: RangePreset;
  /** Tahap yang sedang disaring (null = tidak ada). */
  tahapAktif: TahapOperasional | null;
  /** Klik kartu keadaan → halaman menyaring daftar ke tahap itu (bukti kartu). */
  pilihTahap: (tahap: TahapOperasional) => void;
}

// ── Kartu keadaan ────────────────────────────────────────────────────────────

interface KartuKeadaanDef {
  key: Exclude<TahapOperasional, 'sudahDiserahkan' | 'diterimaShopee'>;
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
};

function buatKartuKeadaan(t: ReturnType<typeof hitungTahap>): KartuKeadaanDef[] {
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
  ];
}

function labelRentang(preset: RangePreset): string {
  return ` pada ${RANGE_LABEL[preset].toLowerCase()}`;
}

// ── Komponen utama ───────────────────────────────────────────────────────────

export function OperasionalSectionPesanan({
  preset,
  tahapAktif,
  pilihTahap,
}: OperasionalSectionProps) {
  const { can } = usePermission();

  // Semua hook HARUS dipanggil di urutan yang sama setiap render.
  // Permission check dilakukan SETELAH semua hook agar tidak melanggar rules-of-hooks.
  const [data, setData] = useState<OperasionalData | null>(null);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState('');

  useEffect(() => {
    let dibatalkan = false;
    void (async () => {
      try {
        const hasil = await api<OperasionalData>(`/api/v1/reports/operations?range=${preset}`);
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
    <section className="card mb16" aria-label="Ringkasan operasional gudang">
      <div>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Ringkasan Operasional Gudang</h2>
        <p className="small muted" style={{ margin: '2px 0 0' }}>
          Keadaan gudang sekarang + kejadian pada rentang tanggal yang dipilih di atas.
        </p>
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
          {/* ── Bagian 1: Keadaan SEKARANG (kartu dapat diklik = bukti) ──── */}
          <div className="stat-grid" style={{ marginTop: 12 }}>
            {kartuKeadaan.map((k) => {
              const aktif = tahapAktif === k.key;
              const Icon = k.ikon;
              return (
                <button
                  key={k.key}
                  type="button"
                  className="stat-card"
                  style={{
                    borderLeft: `3px solid ${k.warna}`,
                    textAlign: 'left',
                    cursor: 'pointer',
                    outline: aktif ? `2px solid ${k.warna}` : undefined,
                  }}
                  onClick={() => pilihTahap(k.key)}
                  aria-pressed={aktif}
                  title={`Tampilkan pesanan: ${k.label}`}
                >
                  <div className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icon size={13} aria-hidden /> {k.label}
                  </div>
                  <div className="stat-value">{k.nilai}</div>
                  <div className="small muted">
                    {aktif ? 'diklik — daftar di bawah hanya pesanan ini' : k.hint}
                  </div>
                </button>
              );
            })}
          </div>

          {/* ── Bagian 2: Aksi di aplikasi DALAM RENTANG ─────────────────── */}
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--divider)' }}>
            <p className="small muted" style={{ margin: '0 0 10px' }}>
              Rentang tanggal yang dipilih: <strong>{RANGE_LABEL[preset]}</strong>
            </p>
            <div className="stat-grid">
              <div className="stat-card">
                <div className="small muted">Dipacking via aplikasi{labelRentang(preset)}</div>
                <div className="stat-value">{data.kejadian.dipacking}</div>
                <div className="small muted">paket dibungkus lewat layar ini (aktor tercatat)</div>
              </div>
              <div className="stat-card">
                <div className="small muted">Diserahkan via aplikasi{labelRentang(preset)}</div>
                <div className="stat-value">{data.kejadian.diserahkan}</div>
                <div className="small muted">paket diserahterimakan lewat layar ini (aktor tercatat)</div>
              </div>
            </div>
          </div>

          {/* ── Bagian 3: Kejadian dari Shopee DALAM RENTANG ─────────────── */}
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--divider)' }}>
            <p className="small muted" style={{ margin: '0 0 10px' }}>
              Kejadian dari Shopee — paket yang dikirim lewat Seller Centre tetap terhitung di sini,
              karena kejadian ini terjadi di Shopee, bukan lewat layar aplikasi.
            </p>
            <div className="stat-grid">
              <div className="stat-card">
                <div className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <PackageCheck size={13} aria-hidden /> Dijemput kurir Shopee{labelRentang(preset)}
                </div>
                <div className="stat-value">{data.kejadianShopee.dijemputKurir}</div>
                <div className="small muted">
                  paket yang sudah keluar gudang menurut Shopee
                  <br />
                  <CheckCircle2 size={11} aria-hidden style={{ display: 'inline' }} /> dihitung dari tanggal
                  kejadian, bukan waktu sinkron
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
