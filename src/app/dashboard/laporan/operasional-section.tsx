'use client';

import { useEffect, useState } from 'react';
import { Boxes, CheckCircle2, ClipboardList, Loader2, Package, Truck, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';

interface PaketPerPelaku {
  id: string;
  nama: string;
  jumlah: number;
}

interface Ringkas {
  preset: string;
  tahap: {
    perluProduksi: number;
    siapDiambil: number;
    sedangDipacking: number;
    siapDiserahkan: number;
    sudahDiserahkan: number;
    diterimaShopee: number;
    gagal: number;
  };
  kejadian: { dipacking: number; diserahkan: number; diterimaKurirShopee: number };
  packing: { daftar: PaketPerPelaku[]; tanpaNama: number };
  serahTerima: { daftar: PaketPerPelaku[]; tanpaNama: number };
}

const PRESET: { id: string; label: string }[] = [
  { id: 'today', label: 'Hari ini' },
  { id: 'yesterday', label: 'Kemarin' },
  { id: 'last7', label: '7 hari' },
  { id: 'last30', label: '30 hari' },
  { id: 'all', label: 'Semua' },
];

/**
 * Ringkasan operasional untuk owner: keadaan gudang sekarang, jumlah paket
 * yang benar-benar dipacking & diserahkan pada rentang tanggal terpilih, dan
 * rekap per pelaku (dasar pembayaran packer / kurir internal per paket).
 */
export function OperasionalSection() {
  const [preset, setPreset] = useState('today');
  const [data, setData] = useState<Ringkas | null>(null);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState('');

  // Setiap perubahan rentang mengambil data baru. Tidak ada `setState` sinkron di
  // dalam effect (aturan React Compiler): keadaan hanya diubah setelah await,
  // dan hasil lama dibuang bila rentang berubah sebelum permintaan selesai.
  useEffect(() => {
    let dibatalkan = false;
    void (async () => {
      try {
        const hasil = await api<Ringkas>(`/api/v1/reports/operations?range=${preset}`);
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

  const kartuSekarang = data
    ? [
        { label: 'Perlu Produksi', nilai: data.tahap.perluProduksi, ikon: Boxes, tone: 'var(--warning)' },
        { label: 'Siap Diambil', nilai: data.tahap.siapDiambil, ikon: ClipboardList, tone: 'var(--info)' },
        { label: 'Sedang Dipacking', nilai: data.tahap.sedangDipacking, ikon: Package, tone: 'var(--primary-solid)' },
        { label: 'Siap Diserahkan', nilai: data.tahap.siapDiserahkan, ikon: Truck, tone: 'var(--primary-solid)' },
        { label: 'Gagal / Tertahan', nilai: data.tahap.gagal, ikon: AlertTriangle, tone: 'var(--danger)' },
      ]
    : [];

  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="queue-card-head" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16 }}>Operasional Gudang</h2>
          <p className="small muted" style={{ margin: '2px 0 0' }}>
            Keadaan sekarang + paket yang benar-benar dipacking/diserahkan pada rentang tanggal.
          </p>
        </div>
        <div className="filter-chips-wrap">
          {PRESET.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`chip${preset === p.id ? ' chip-active' : ''}`}
              onClick={() => setPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {memuat && !data ? (
        <p className="small muted" style={{ padding: 12 }}>
          <Loader2 size={14} className="spin" aria-hidden /> Memuat ringkasan…
        </p>
      ) : galat ? (
        <p className="small" style={{ color: 'var(--danger)', padding: 12 }}>{galat}</p>
      ) : data ? (
        <>
          <div className="stat-grid" style={{ marginTop: 12 }}>
            {kartuSekarang.map((k) => (
              <div key={k.label} className="card" style={{ padding: 12, borderLeft: `3px solid ${k.tone}` }}>
                <div className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <k.ikon size={13} aria-hidden /> {k.label}
                </div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{k.nilai}</div>
                <div className="small muted">paket</div>
              </div>
            ))}
          </div>

          <div className="stat-grid" style={{ marginTop: 12 }}>
            <div className="card" style={{ padding: 12 }}>
              <div className="small muted">Dipacking (rentang ini)</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{data.kejadian.dipacking} paket</div>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div className="small muted">Diserahkan ke kurir (rentang ini)</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{data.kejadian.diserahkan} paket</div>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckCircle2 size={13} aria-hidden /> Diterima kurir Shopee
              </div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{data.kejadian.diterimaKurirShopee} paket</div>
            </div>
          </div>

          <div className="table-wrap" style={{ marginTop: 16 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Pelaku</th>
                  <th className="num">Paket dipacking</th>
                  <th className="num">Paket diserahkan</th>
                </tr>
              </thead>
              <tbody>
                {gabungPelaku(data).map((p) => (
                  <tr key={p.id}>
                    <td style={{ wordBreak: 'break-word' }}>{p.nama}</td>
                    <td className="num">{p.packing || '—'}</td>
                    <td className="num">{p.serah || '—'}</td>
                  </tr>
                ))}
                {gabungPelaku(data).length === 0 && (
                  <tr>
                    <td colSpan={3} className="small muted" style={{ textAlign: 'center', padding: 12 }}>
                      Belum ada paket dipacking/diserahkan pada rentang ini.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ margin: '8px 0 0' }}>
            Satu orang bisa muncul di kedua kolom (merangkap packer dan kurir internal) — bayaran
            dihitung terpisah per paket.
            {data.packing.tanpaNama + data.serahTerima.tanpaNama > 0
              ? ` ${data.packing.tanpaNama + data.serahTerima.tanpaNama} paket lama belum punya catatan pelaku.`
              : ''}
          </p>
        </>
      ) : null}
    </section>
  );
}

/** Gabungkan dua rekap (packing & serah terima) per orang. */
function gabungPelaku(data: Ringkas) {
  const peta = new Map<string, { id: string; nama: string; packing: number; serah: number }>();
  for (const p of data.packing.daftar) {
    peta.set(p.id, { id: p.id, nama: p.nama, packing: p.jumlah, serah: 0 });
  }
  for (const s of data.serahTerima.daftar) {
    const ada = peta.get(s.id);
    if (ada) ada.serah += s.jumlah;
    else peta.set(s.id, { id: s.id, nama: s.nama, packing: 0, serah: s.jumlah });
  }
  return [...peta.values()].sort((a, b) => b.packing + b.serah - (a.packing + a.serah));
}
