"use client";

import { useEffect, useMemo, useState } from 'react';
import { FileDown, Loader2, Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, LoadingState, ErrorState, EmptyState } from '@/components/ui';

interface PesananProduksi {
  orderId: string;
  externalOrderId: string;
  tanggal: string;
  batasKirim: string | null;
  qty: number;
  sku: string;
}

interface GrupProduksi {
  nama: string;
  jilid: number | null;
  totalUnit: number;
  pesanan: PesananProduksi[];
}

interface PesananMendesak {
  orderId: string;
  externalOrderId: string;
  nama: string;
  qty: number;
  batasKirim: string;
  sisaTeks: string;
  nada: 'lewat' | 'kritis' | 'waspada' | 'aman';
  jam: number;
}

interface CetakanTerakhir {
  kodeBatch: string;
  printedAt: string;
  totalOrders: number;
  totalUnits: number;
}

interface Daftar {
  kodeBatch: string;
  terakhirDicetak: CetakanTerakhir | null;
  mendesak: PesananMendesak[];
  totalPesanan: number;
  totalUnit: number;
  grup: GrupProduksi[];
}

/**
 * Halaman Produksi.
 *
 * Alurnya sengaja satu arah: pilih pesanan → cetak PDF → serahkan ke tim
 * produksi. Tidak ada panel saran yang harus ditafsirkan; urutannya sudah
 * bawaan: produk SET lebih dulu, lalu jilid 1, 2, 3, …
 */
/** Warna teks hitung mundur sesuai tingkatnya (lewat = paling mendesak). */
const NADA_WARNA: Record<PesananMendesak['nada'], string> = {
  lewat: 'var(--danger)',
  kritis: 'var(--danger)',
  waspada: 'var(--warning)',
  aman: 'var(--muted)',
};

/** Rentang tanggal pesanan pada satu produk ("20 Okt" atau "20-22 Okt"). */
function rentangTanggal(pesanan: PesananProduksi[]): string {
  if (pesanan.length === 0) return '-';
  const unik = [...new Set(pesanan.map((p) => p.tanggal.slice(0, 10)))].sort();
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  if (unik.length === 1) return fmt(unik[0] as string);
  return `${fmt(unik[0] as string)}-${fmt(unik[unik.length - 1] as string)}`;
}

export default function ProduksiPage() {
  const [data, setData] = useState<Daftar | null>(null);
  const [dipilih, setDipilih] = useState<string[]>([]);
  const [memuat, setMemuat] = useState(true);
  const [mencetak, setMencetak] = useState(false);
  const [galat, setGalat] = useState('');
  const [pesan, setPesan] = useState('');

  // Muat sekali saat halaman dibuka. Keadaan hanya diubah setelah `await`
  // (aturan React Compiler: tidak ada setState sinkron di dalam effect), dan
  // hasil yang datang setelah komponen dilepas diabaikan.
  useEffect(() => {
    let dibatalkan = false;
    void (async () => {
      try {
        const res = await api<Daftar>('/api/v1/fulfillment/production-list');
        if (dibatalkan) return;
        setData(res);
        setGalat('');
        setMemuat(false);
      } catch (e) {
        if (dibatalkan) return;
        setGalat((e as Error).message);
        setMemuat(false);
      }
    })();
    return () => {
      dibatalkan = true;
    };
  }, []);

  const semuaId = useMemo(
    () => (data?.grup ?? []).flatMap((g) => g.pesanan.map((p) => p.orderId)),
    [data],
  );

  const toggleGrup = (g: GrupProduksi) => {
    const ids = g.pesanan.map((p) => p.orderId);
    const semuaTerpilih = ids.every((id) => dipilih.includes(id));
    setDipilih((prev) => (semuaTerpilih ? prev.filter((id) => !ids.includes(id)) : [...new Set([...prev, ...ids])]));
  };

  const cetak = async (hanyaTerpilih: boolean) => {
    setMencetak(true);
    setPesan('');
    try {
      const res = await fetch('/api/v1/fulfillment/production-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds: hanyaTerpilih ? dipilih : [] }),
      });
      if (!res.ok) {
        const info = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(info.error?.message ?? `Gagal membuat PDF (HTTP ${res.status}).`);
      }
      const duplikat = res.headers.get('X-Batch-Duplikat') === 'true';
      const kodeBatch = res.headers.get('X-Batch-Kode') ?? data?.kodeBatch ?? '';
      const dicetakPada = res.headers.get('X-Batch-Dicetak-Pada');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `daftar-produksi-${kodeBatch}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setPesan(
        duplikat && dicetakPada
          ? `Sudah dicetak ${new Date(dicetakPada).toLocaleString('id-ID')} — jangan produksi dua kali.`
          : `PDF dibuat untuk ${hanyaTerpilih ? dipilih.length : semuaId.length} pesanan (${kodeBatch}).`,
      );
    } catch (e) {
      setPesan((e as Error).message);
    } finally {
      setMencetak(false);
    }
  };

  if (memuat) return <LoadingState message="Memuat daftar produksi..." />;
  if (galat) {
    return (
      <ErrorState
        message={galat}
        onRetry={() => {
          // Muat ulang penuh: kembali ke keadaan "memuat" lalu ambil data lagi.
          window.location.reload();
        }}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Produksi"
        subtitle={
          data?.terakhirDicetak
            ? `Terakhir dicetak: ${data.terakhirDicetak.kodeBatch} · ${data.terakhirDicetak.totalOrders} pesanan · ${new Date(
                data.terakhirDicetak.printedAt,
              ).toLocaleString('id-ID')}.`
            : 'Pesanan yang masih harus dikerjakan. Pilih yang mau diproses, lalu cetak lembar kerja.'
        }
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={mencetak || semuaId.length === 0}
              onClick={() => void cetak(false)}
            >
              <FileDown size={14} aria-hidden /> Cetak semua ({semuaId.length})
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={mencetak || dipilih.length === 0}
              onClick={() => void cetak(true)}
            >
              {mencetak ? <Loader2 size={14} className="spin" aria-hidden /> : <Printer size={14} aria-hidden />}
              Cetak terpilih ({dipilih.length})
            </button>
          </div>
        }
      />

      {pesan && <p className="small" style={{ margin: '0 0 12px', color: 'var(--info)' }}>{pesan}</p>}

      {!data || data.grup.length === 0 ? (
        <EmptyState title="Tidak ada yang perlu diproduksi" description="Semua pesanan sudah punya stok di gudang." />
      ) : (
        <>
          <div className="chip-row" style={{ marginBottom: 12 }}>
            <span className="chip chip-active">{data.totalPesanan} pesanan</span>
            <span className="chip">{data.totalUnit} unit</span>
            <span className="chip">Batch {data.kodeBatch}</span>
            <button
              type="button"
              className="chip"
              onClick={() => setDipilih(dipilih.length === semuaId.length ? [] : semuaId)}
            >
              {dipilih.length === semuaId.length ? 'Batalkan semua' : 'Pilih semua'}
            </button>
          </div>

          {data.mendesak.length > 0 && (
            <section className="card" style={{ marginBottom: 12 }}>
              <div className="queue-card-head" style={{ flexWrap: 'wrap', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <h2 style={{ margin: 0, fontSize: 15 }}>Paling dekat dibatalkan otomatis</h2>
                  <p className="small muted" style={{ margin: '2px 0 0' }}>
                    Kalau batas kirim terlewat, Shopee membatalkan pesanannya sendiri.
                  </p>
                </div>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Produk</th>
                      <th className="num">Qty</th>
                      <th>Batas kirim</th>
                      <th>Sisa waktu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.mendesak.map((m) => (
                      <tr key={m.orderId}>
                        <td style={{ fontWeight: 600 }}>
                          {m.nama}
                          <span className="small muted" style={{ display: 'block', fontWeight: 400 }}>
                            {m.externalOrderId}
                          </span>
                        </td>
                        <td className="num">{m.qty}</td>
                        <td className="small muted">
                          {new Date(m.batasKirim).toLocaleString('id-ID', {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="small" style={{ color: NADA_WARNA[m.nada], fontWeight: 600 }}>
                          {m.sisaTeks}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <div className="card">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 34 }} />
                    <th>Produk</th>
                    <th className="num">Qty</th>
                    <th>Tanggal pesanan</th>
                    <th className="num">Resi</th>
                  </tr>
                </thead>
                <tbody>
                  {data.grup.map((g) => {
                    const semuaId = g.pesanan.map((p) => p.orderId);
                    const terpilih = semuaId.every((id) => dipilih.includes(id));
                    return (
                      <tr key={g.nama}>
                        <td>
                          <input
                            type="checkbox"
                            checked={terpilih}
                            onChange={() => toggleGrup(g)}
                            aria-label={`Pilih ${g.nama}`}
                          />
                        </td>
                        <td style={{ fontWeight: 600 }}>{g.nama}</td>
                        <td className="num">{g.totalUnit}</td>
                        <td className="small muted">{rentangTanggal(g.pesanan)}</td>
                        <td className="num small muted">{g.pesanan.length}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
