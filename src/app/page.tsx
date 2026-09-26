import Link from 'next/link';
import { PackageCheck, ScanLine, Boxes, Workflow, Truck, ChartColumn } from 'lucide-react';

const FEATURES = [
  { icon: Workflow, title: 'Prioritas Cerdas', desc: 'Urutan kerja otomatis berdasarkan deadline & SLA' },
  { icon: Boxes, title: 'Stok Akurat', desc: 'Ledger pergerakan stok yang tersinkron real-time' },
  { icon: ScanLine, title: 'Scanner Barcode', desc: 'Validasi picking & packing tanpa salah ambil' },
  { icon: Truck, title: 'Pengiriman & Resi', desc: 'Pantau resi dan status pengiriman dari Shopee' },
  { icon: ChartColumn, title: 'Laporan Operasional', desc: 'Metrik yang bisa dipertanggungjawabkan' },
];

export default function HomePage() {
  return (
    <main style={{ minHeight: '100vh', background: 'var(--background)' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '64px 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <span style={{ display: 'inline-flex', width: 52, height: 52, alignItems: 'center', justifyContent: 'center', background: 'var(--primary)', color: '#fff', borderRadius: 'var(--r-lg)' }}>
            <PackageCheck size={26} aria-hidden />
          </span>
          <h1 style={{ fontSize: 34, fontWeight: 700, marginTop: 16, lineHeight: 1.2 }}>
            Fulfillment marketplace,<br />tertata dalam satu platform
          </h1>
          <p className="muted" style={{ fontSize: 16, marginTop: 12, maxWidth: 560, margin: '12px auto 0' }}>
            Kelola pesanan, stok, picking, packing, dan pengiriman Shopee — dengan prioritas yang bisa dijelaskan.
          </p>
          <div className="row" style={{ justifyContent: 'center', marginTop: 24 }}>
            <Link href="/login" className="btn btn-primary" style={{ height: 44, padding: '0 24px', fontSize: 15 }}>
              Masuk ke Dashboard
            </Link>
            <Link href="/register" className="btn btn-secondary" style={{ height: 44, padding: '0 24px', fontSize: 15 }}>
              Daftar Gratis
            </Link>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.title} className="card">
                <Icon size={22} strokeWidth={1.75} style={{ color: 'var(--primary-strong)' }} aria-hidden />
                <div style={{ fontWeight: 600, marginTop: 12 }}>{f.title}</div>
                <div className="muted small" style={{ marginTop: 4 }}>{f.desc}</div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
