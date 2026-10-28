'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { api } from '@/lib/api';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui';

/**
 * Rekap Kerja Staf — laporan kerja staf per minggu gaji.
 *
 * Sumber data adalah jejak aksi yang sudah tercatat di setiap paket:
 *  - Kerjaan Packing = jumlah resi yang staf selesaikan (packedAt)
 *  - Kerjaan Serah Kurir = jumlah paket yang staf serahkan ke kurir (handedOverAt)
 *
 * Minggu gaji memakai tanggal tetap: 1–7, 8–14, 15–21, 22–akhir bulan.
 * Laporan bersifat read-only dan hanya bisa diakses owner (page.reports).
 */

interface RekapPerJenis {
  jenis: 'packing' | 'serahKirim';
  label: string;
  daftar: Array<{
    userId: string;
    nama: string;
    total: number;
    perHari: Array<{
      tanggal: number;
      jumlah: number;
      rincian: Array<{ orderCode: string | null; jam: string }>;
    }>;
  }>;
}

interface RingkasanPerOrang {
  userId: string;
  nama: string;
  totalPacking: number;
  totalSerahKirim: number;
  totalSemua: number;
}

interface RekapKerjaStaf {
  rentang: {
    dari: string;
    sampai: string;
    minggu: 1 | 2 | 3 | 4;
    bulan: number;
    tahun: number;
    label: string;
  };
  namaHari: string[];
  kolomHari: number[];
  packing: RekapPerJenis;
  serahKirim: RekapPerJenis;
  ringkasan: RingkasanPerOrang[];
}

const NAMA_BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

const PILIHAN_MINGGU = [1, 2, 3, 4] as const;

export default function RekapKerjaStafSection() {
  // Default: bulan & tahun hari ini. Minggu diisi otomatis oleh API
  // (jika parameter minggu tidak diberikan, API memakai minggu hari ini).
  const sekarang = new Date();
  const [tahun, setTahun] = useState(sekarang.getFullYear());
  const [bulan, setBulan] = useState(sekarang.getMonth() + 1);
  const [minggu, setMinggu] = useState<1 | 2 | 3 | 4>(1);
  const [data, setData] = useState<RekapKerjaStaf | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api<RekapKerjaStaf>(
      `/api/v1/reports/rekap-kerja-staf?tahun=${tahun}&bulan=${bulan}&minggu=${minggu}`,
    )
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        setError((e as Error).message);
        setLoading(false);
      });
  }, [tahun, bulan, minggu]);

  useEffect(() => {
    load();
  }, [load]);

  // Pilihan tahun: 3 tahun ke belakang sampai tahun ini (cukup untuk audit gaji).
  const pilihanTahun = useMemo(() => {
    const tahunIni = new Date().getFullYear();
    return [tahunIni - 2, tahunIni - 1, tahunIni];
  }, []);

  const pilihanBulan = useMemo(() => NAMA_BULAN.map((nama, i) => ({ nilai: i + 1, nama })), []);

  return (
    <div className="card mb24">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <Users size={18} style={{ color: 'var(--secondary)' }} aria-hidden />
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>Rekap Kerja Staf</h2>
      </div>

      {/* Filter Bulan + Tahun + Minggu */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="small muted">Bulan</span>
          <select
            className="input"
            value={bulan}
            onChange={(e) => setBulan(Number(e.target.value))}
            style={{ minWidth: 150 }}
          >
            {pilihanBulan.map((b) => (
              <option key={b.nilai} value={b.nilai}>{b.nama}</option>
            ))}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="small muted">Tahun</span>
          <select
            className="input"
            value={tahun}
            onChange={(e) => setTahun(Number(e.target.value))}
            style={{ minWidth: 110 }}
          >
            {pilihanTahun.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="small muted">Minggu</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {PILIHAN_MINGGU.map((m) => (
              <button
                key={m}
                type="button"
                className={`btn btn-sm ${minggu === m ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setMinggu(m)}
                aria-pressed={minggu === m}
              >
                Minggu {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <LoadingState message="Memuat rekap kerja staf..." />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !data || (data.packing.daftar.length === 0 && data.serahKirim.daftar.length === 0) ? (
        <EmptyState
          title="Belum ada catatan kerja di minggu ini"
          description="Angka akan muncul secara otomatis setelah staf menyelesaikan packing atau menyerahkan paket ke kurir."
        />
      ) : (
        <>
          <p className="small muted" style={{ marginBottom: 16 }}>
            Menampilkan: <strong>Minggu ke-{data.rentang.minggu}</strong> ({data.rentang.label})
          </p>

          <TabelRekap judul="Kerjaan Packing (scan resi)" data={data.packing} kolomHari={data.kolomHari} namaHari={data.namaHari} bulanLabel={NAMA_BULAN[data.rentang.bulan - 1] ?? ''} />
          <TabelRekap judul="Kerjaan Serah Kurir (tekan tombol)" data={data.serahKirim} kolomHari={data.kolomHari} namaHari={data.namaHari} bulanLabel={NAMA_BULAN[data.rentang.bulan - 1] ?? ''} />

          {/* Ringkasan per orang — yang dilihat owner saat menggaji */}
          <div style={{ marginTop: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Ringkasan per Orang</h3>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Nama Staf</th>
                    <th className="num">Total Packing</th>
                    <th className="num">Total Kirim</th>
                    <th className="num">Total Semua</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ringkasan.map((r) => (
                    <tr key={r.userId}>
                      <td style={{ fontWeight: 600 }}>{r.nama}</td>
                      <td className="num">{r.totalPacking}</td>
                      <td className="num">{r.totalSerahKirim}</td>
                      <td className="num" style={{ fontWeight: 700 }}>{r.totalSemua}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Tabel rekap satu jenis kerjaan: baris = staf, kolom = tanggal, ujung = total. */
function TabelRekap({
  judul,
  data,
  kolomHari,
  namaHari,
  bulanLabel,
}: {
  judul: string;
  data: RekapPerJenis;
  kolomHari: number[];
  namaHari: string[];
  bulanLabel: string;
}) {
  // Sel harian yang sedang dibuka rinciannya: `${userId}|${tanggal}`.
  const [selAktif, setSelAktif] = useState<string | null>(null);

  if (data.daftar.length === 0) {
    return (
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{judul}</h3>
        <p className="small muted">Tidak ada catatan untuk kerjaan ini di minggu tersebut.</p>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{judul}</h3>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Nama Staf</th>
              {kolomHari.map((tgl, i) => (
                <th key={tgl} className="num" title={`${namaHari[i]}, ${tgl} ${bulanLabel}`}>
                  {tgl}
                </th>
              ))}
              <th className="num">Total</th>
            </tr>
            <tr>
              <th aria-hidden />
              {namaHari.map((h, i) => (
                <th key={i} className="num small muted" style={{ fontWeight: 400 }}>
                  {h.slice(0, 3)}
                </th>
              ))}
              <th aria-hidden />
            </tr>
          </thead>
          <tbody>
            {data.daftar.map((staf) => {
              const petaHari = new Map(staf.perHari.map((p) => [p.tanggal, p]));
              return (
                <Fragment key={staf.userId}>
                  <tr>
                    <td style={{ fontWeight: 600 }}>{staf.nama}</td>
                    {kolomHari.map((tgl) => {
                      const sel = petaHari.get(tgl);
                      const jumlah = sel?.jumlah ?? 0;
                      const kunci = `${staf.userId}|${tgl}`;
                      const aktif = selAktif === kunci;
                      return (
                        <td
                          key={tgl}
                          className="num"
                          style={
                            jumlah === 0
                              ? { color: 'var(--text-muted)' }
                              : aktif
                                ? { fontWeight: 700, background: 'var(--surface-low)' }
                                : { fontWeight: 600, cursor: 'pointer' }
                          }
                          {...(jumlah > 0
                            ? {
                                onClick: () => setSelAktif(aktif ? null : kunci),
                                title: `${staf.nama} — ${jumlah} paket pada tanggal ${tgl}. Klik untuk rincian.`,
                              }
                            : {})}
                        >
                          {jumlah > 0 ? jumlah : '–'}
                        </td>
                      );
                    })}
                    <td className="num" style={{ fontWeight: 700 }}>{staf.total}</td>
                  </tr>
                  {selAktif?.startsWith(`${staf.userId}|`) && (
                    <tr key={`${staf.userId}-rincian`}>
                      <td colSpan={kolomHari.length + 2} style={{ padding: '8px 12px', background: 'var(--surface-low)' }}>
                        <RincianHarian sel={petaHari.get(Number(selAktif.split('|')[1]))} namaBulan={bulanLabel} namaStaf={staf.nama} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Rincian pesanan untuk sel harian yang diklik — nomor pesanan + jam. */
function RincianHarian({
  sel,
  namaStaf,
  namaBulan,
}: {
  sel: { tanggal: number; jumlah: number; rincian: Array<{ orderCode: string | null; jam: string }> } | undefined;
  namaStaf: string;
  namaBulan: string;
}) {
  if (!sel) return null;
  return (
    <div>
      <p className="small" style={{ fontWeight: 600, marginBottom: 6 }}>
        {namaStaf} — {sel.jumlah} paket pada tanggal {sel.tanggal} {namaBulan}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {sel.rincian.map((r, i) => (
          <span
            key={i}
            className="small mono"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--divider)',
              borderRadius: 'var(--r-sm)',
              padding: '2px 8px',
            }}
            title={`${r.orderCode ?? 'tanpa nomor'} — pukul ${r.jam} WIB`}
          >
            {r.orderCode ?? 'tanpa nomor'} · {r.jam}
          </span>
        ))}
      </div>
    </div>
  );
}
