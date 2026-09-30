---
version: 1.0.0
status: normative
name: E-Fulfill Hub — Shopee Design System
description: >-
  Design system untuk E-Fulfill Hub, aplikasi operasional fulfillment marketplace Shopee.
  Turunan resmi dari brand system Shopee (Warm Minimalism + Soft-Technical geometry),
  dikoreksi untuk kebutuhan aplikasi operasional: tanpa gradient, tanpa ikon emoji,
  ikon dari Lucide, kontras aksesibilitas terverifikasi WCAG 2.2 AA.
supersedes: 03-DESIGN.md (technical design — tetap berlaku untuk arsitektur, bukan visual)
logo:
  src: /logo-mark.svg
  note: >-
    Gunakan wordmark/ikon produk sendiri. JANGAN memakai logo Shopee, icon_favicon,
    atau aset merek Shopee apa pun sebagai identitas aplikasi ini — hanya warna brand
    yang diadopsi. Lihat bagian "Brand & Legal".
fonts:
  ui: Roboto
  fallback: 'system-ui, -apple-system, "Segoe UI", Arial, sans-serif'
  note: >-
    SHPBurmese/SHPKhmer adalah font proprietary Shopee dan TIDAK boleh/ tidak bisa
    didistribusikan. Diganti Roboto + fallback sistem. Mono: Roboto Mono.
colors:
  # ---- Brand ----
  primary: '#ee4d2d'
  primary-hover: '#d0011b'
  primary-active: '#c20014'
  primary-strong: '#d0011b'        # NEW — untuk teks/badge kecil di atas putih (AA 5.67:1)
  on-primary: '#ffffff'
  primary-container: '#fef6f5'
  on-primary-container: '#ee4d2d'
  secondary: '#0046ab'
  on-secondary: '#ffffff'
  secondary-container: '#e3f0ff'
  on-secondary-container: '#0046ab'
  tertiary: '#eda500'
  on-tertiary: '#212121'           # KOREKSI — sebelumnya #ffffff (kontras 2.10:1, GAGAL AA)
  tertiary-container: '#fff8e4'
  on-tertiary-container: '#7a5300' # KOREKSI — #eda500 di atas putih hanya 2.10:1
  error: '#ee2c4a'
  on-error: '#ffffff'
  error-container: '#fff4f4'
  on-error-container: '#b3122f'    # KOREKSI — #ee2c4a di atas putih hanya 4.12:1
  success: '#1a7f4b'               # NEW — tidak ada di spec awal, dibutuhkan UI operasional
  on-success: '#ffffff'
  success-container: '#e8f6ee'
  on-success-container: '#0f5c35'
  # ---- Surface ----
  background: '#f5f5f5'
  on-background: '#212121'
  surface: '#f5f5f5'
  surface-dim: '#ebebeb'
  surface-bright: '#ffffff'
  surface-container-lowest: '#fafafa'
  surface-container-low: '#f5f5f5'
  surface-container: '#f0f0f0'
  surface-container-high: '#e8e8e8'
  surface-container-highest: '#e0e0e0'
  on-surface: '#212121'
  on-surface-variant: '#595959'
  surface-variant: '#e8e8e8'
  inverse-surface: '#212121'
  inverse-on-surface: '#f5f5f5'
  # ---- Lines ----
  outline: '#757575'               # KOREKSI — #bdbdbd hanya 1.87:1 (butuh >=3:1 utk border interaktif)
  outline-variant: '#e8e8e8'       # dekoratif saja, bukan pembatas kontrol interaktif
  divider: '#ebebeb'
  focus-ring: '#0046ab'            # NEW — fokus selalu biru, jangan merah (merah = bahaya)
typography:
  display:
    fontFamily: Roboto
    fontSize: 56px
    fontWeight: '700'
    lineHeight: 64px
    letterSpacing: '-0.02em'
  headline-lg:
    fontFamily: Roboto
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: '-0.01em'
  headline-md:
    fontFamily: Roboto
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  title-lg:
    fontFamily: Roboto
    fontSize: 20px
    fontWeight: '500'
    lineHeight: 28px
  title-md:
    fontFamily: Roboto
    fontSize: 16px
    fontWeight: '500'
    lineHeight: 24px
  body-lg:
    fontFamily: Roboto
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Roboto
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Roboto
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Roboto
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.02em
  code:
    fontFamily: Roboto Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
rounded:
  none: 0
  sm: 2px
  DEFAULT: 4px
  md: 6px
  lg: 8px
  xl: 12px
  full: 9999px
  rule: >-
    Maksimum 8px untuk komponen. Hanya badge/pill/avatar/status-dot yang memakai full.
spacing:
  unit: 8px
  scale: [0, 4, 8, 12, 16, 24, 32, 40, 48, 64]
  micro: 4px
  tight: 8px
  sm: 12px
  base: 16px
  md: 24px
  lg: 40px
  xl: 64px
  gutter: 24px
  # App shell (bukan halaman marketing) — fluid, bukan 1200px fixed:
  container-max-marketing: 1200px
  container-max-app: 1600px
  sidebar-width: 240px
  sidebar-width-collapsed: 64px
  header-height: 56px
  density:
    comfortable: 44px     # default tabel operasional
    compact: 36px         # tabel panjang (pesanan, movement ledger)
elevation:
  none: none
  sm: 0 1px 1px 0 rgba(0, 0, 0, 0.05)
  md: 0 3px 8px rgba(0, 0, 0, 0.15)
  lg: 0 8px 24px rgba(0, 0, 0, 0.12)
motion:
  duration-fast: 120ms
  duration-base: 200ms
  duration-slow: 320ms
  easing: cubic-bezier(0.2, 0, 0, 1)
  rule: >-
    Transisi hanya untuk opacity, warna, shadow, transform kecil (<=2px).
    Hormati prefers-reduced-motion. Jangan animasikan layout/lebar/tinggi.
breakpoints:
  sm: 640px
  md: 768px
  lg: 1024px
  xl: 1280px
  2xl: 1536px
layout:
  containerMaxWidth: 1600px
  gridColumns: 12
  appShell: sidebar + sticky header + fluid content
icons:
  library: lucide-react
  strokeWidth: 1.75
  sizes:
    inline: 16px
    default: 20px
    nav: 20px
    feature: 24px
    emptyState: 32px
  rule: >-
    Ikon hanya dari lucide-react. Dilarang emoji di seluruh UI, dokumentasi produk,
    label, toast, dan pesan sistem. Dilarang meng-upload SVG acak. Ikon dekoratif
    wajib aria-hidden; ikon yang menjadi satu-satunya label tombol wajib punya
    aria-label. Ikon tidak pernah menjadi satu-satunya pembawa status — selalu
    didampingi teks.
components:
  # ---------- Actions ----------
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.on-primary}'
    typography: '{typography.label-md}'
    rounded: '{rounded.sm}'
    padding: 8px 16px
    height: 40px
    minWidth: 120px
    note: Tinggi 40px desktop / 44px layar sentuh. Teks 600 jika ukuran < 16px.
  button-primary-hover:
    backgroundColor: '{colors.primary-hover}'
  button-primary-active:
    backgroundColor: '{colors.primary-active}'
  button-primary-strong:
    backgroundColor: '{colors.primary-strong}'
    textColor: '{colors.on-primary}'
    note: >-
      Varian teks kecil di atas putih, kontras 5.67:1. Wajib dipakai untuk CTA
      teks < 16px agar tetap lulus WCAG AA.
  button-secondary:
    backgroundColor: '{colors.surface-bright}'
    textColor: '{colors.primary-strong}'
    typography: '{typography.label-md}'
    rounded: '{rounded.sm}'
    padding: 8px 16px
    height: 40px
    border: '1px solid {colors.primary}'
  button-secondary-hover:
    backgroundColor: '{colors.primary-container}'
  button-ghost:
    backgroundColor: transparent
    textColor: '{colors.primary-strong}'
    typography: '{typography.label-md}'
    rounded: '{rounded.sm}'
    padding: 8px 16px
  button-ghost-hover:
    backgroundColor: rgba(238, 77, 45, 0.08)
  button-danger:
    backgroundColor: '{colors.surface-bright}'
    textColor: '{colors.on-error-container}'
    border: '1px solid {colors.error}'
  button-disabled:
    backgroundColor: '{colors.surface-container-high}'
    textColor: '{colors.on-surface-variant}'
    cursor: not-allowed
    note: opacity TIDAK dipakai untuk disabled (kontras jadi tak terprediksi)
  # ---------- Surfaces ----------
  card:
    backgroundColor: '{colors.surface-bright}'
    rounded: '{rounded.DEFAULT}'
    padding: '{spacing.base}'
    boxShadow: '{elevation.sm}'
    border: '1px solid {colors.divider}'
  card-hover:
    boxShadow: '{elevation.md}'
  panel:
    backgroundColor: '{colors.surface-bright}'
    rounded: '{rounded.lg}'
    boxShadow: '{elevation.lg}'
  # ---------- Forms ----------
  input-field:
    backgroundColor: '{colors.surface-bright}'
    textColor: '{colors.on-surface}'
    typography: '{typography.body-md}'
    rounded: '{rounded.DEFAULT}'
    padding: 8px 12px
    height: 40px
    border: '1px solid {colors.outline}'
  input-field-focus:
    borderColor: '{colors.focus-ring}'
    boxShadow: '0 0 0 3px rgba(0, 70, 171, 0.18)'
  input-field-error:
    borderColor: '{colors.error}'
    helperTextColor: '{colors.on-error-container}'
  select:
    inherit: input-field
  checkbox-radio:
    size: 18px
    accentColor: '{colors.primary}'
  # ---------- Feedback ----------
  badge-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.on-primary}'
    typography: '{typography.label-sm}'
    rounded: '{rounded.full}'
    padding: 4px 8px
  badge-secondary:
    backgroundColor: '{colors.secondary-container}'
    textColor: '{colors.on-secondary-container}'
    typography: '{typography.label-sm}'
    rounded: '{rounded.full}'
    padding: 4px 8px
  badge-warning:
    backgroundColor: '{colors.tertiary-container}'
    textColor: '{colors.on-tertiary-container}'
    typography: '{typography.label-sm}'
    rounded: '{rounded.full}'
    padding: 4px 8px
  badge-success:
    backgroundColor: '{colors.success-container}'
    textColor: '{colors.on-success-container}'
    typography: '{typography.label-sm}'
    rounded: '{rounded.full}'
    padding: 4px 8px
  badge-danger:
    backgroundColor: '{colors.error-container}'
    textColor: '{colors.on-error-container}'
    typography: '{typography.label-sm}'
    rounded: '{rounded.full}'
    padding: 4px 8px
  badge-neutral:
    backgroundColor: '{colors.surface-container-high}'
    textColor: '{colors.on-surface-variant}'
    typography: '{typography.label-sm}'
    rounded: '{rounded.full}'
    padding: 4px 8px
  alert-banner:
    rounded: '{rounded.DEFAULT}'
    padding: 12px 16px
    border: '1px solid currentColor@12%'
    icon: required
    note: Setiap alert memiliki ikon Lucide + judul teks, bukan hanya warna.
  toast:
    rounded: '{rounded.DEFAULT}'
    padding: 12px 16px
    boxShadow: '{elevation.lg}'
    maxStack: 3
    position: bottom-right desktop / top-center mobile
  # ---------- Data display ----------
  table:
    headerBackground: '{colors.surface-container-low}'
    headerTypography: '{typography.label-sm}'
    rowHeight: 44px
    rowHover: '{colors.primary-container}'
    border: '1px solid {colors.divider}'
    stickyHeader: true
    numericAlign: right
    note: Selalu sertakan empty state, loading skeleton, dan pagination.
  list-item:
    backgroundColor: transparent
    rounded: '{rounded.md}'
    padding: '{spacing.sm}'
  list-item-hover:
    backgroundColor: rgba(238, 77, 45, 0.04)
  skeleton:
    backgroundColor: '{colors.surface-container-high}'
    rounded: '{rounded.DEFAULT}'
    animation: pulse 1.5s ease-in-out infinite
  empty-state:
    icon: required
    iconSize: 32px
    titleTypography: '{typography:title-md}'
    bodyTypography: '{typography:body-md}'
    action: required
  # ---------- Navigation ----------
  sidebar:
    width: '{spacing.sidebar-width}'
    backgroundColor: '{colors.surface-bright}'
    borderRight: '1px solid {colors.divider}'
    itemHeight: 40px
    itemActive:
      backgroundColor: '{colors.primary-container}'
      textColor: '{colors.primary-strong}'
      indicator: '3px bar kiri warna primary'
    itemHover:
      backgroundColor: '{colors.surface-container-low}'
  app-header:
    height: '{spacing.header-height}'
    borderBottom: '1px solid {colors.divider}'
    backgroundColor: '{colors.surface-bright}'
  breadcrumb:
    typography: '{typography.label-sm}'
    separator: ChevronRight
  # ---------- Warehouse / Scanner ----------
  scanner-zone:
    rounded: '{rounded.lg}'
    border: '2px dashed {colors.outline}'
    padding: 32px 24px
    states:
      idle: 'outline'
      scanning: 'secondary + ring 2px'
      success: 'success + ikon CheckCircle2'
      error: 'error + ikon XCircle'
    minTargetSize: 48px
  scan-result:
    success: 'Ikon CheckCircle2 + "SKU COCOK — 2/2" warna {colors.on-success-container}'
    mismatch: 'Ikon XCircle + "BARANG SALAH — harusnya SKU ABC-123" warna {colors.on-error-container}'
    rule: Teks wajib. Warna tidak pernah menjadi satu-satunya penanda.
---

# E-Fulfill Hub — Shopee Design System

> Dokumen ini **normatif**. Setiap nilai visual di aplikasi harus berasal dari token di atas.
> Nilai literal di luar token (hex, px, radius, font) adalah pelanggaran dan akan ditolak saat review.

## 1. Ringkasan & alasan perubahan dari spec awal

Design system ini adalah turunan brand system Shopee. Filosofinya dipertahankan:
**Warm Minimalism** (ramai tapi tidak berantakan) dan **Soft-Technical** (tegas tapi manusiawi),
dengan merah Shopee `#ee4d2d` sebagai mercusuar aksi.

Namun spec awal ditulis untuk **storefront konsumen**, sementara aplikasi ini adalah
**alat kerja operator gudang 8 jam sehari**. Empat koreksi struktural:

| # | Spec awal | Masalah nyata | Koreksi |
|---|---|---|---|
| 1 | `on-tertiary: #ffffff` di atas `#eda500` | Kontras **2.10:1** — gagal WCAG AA (butuh 4.5:1). Badge kuning jadi tidak terbaca. | `on-tertiary: #212121` → **7.65:1** |
| 2 | `outline: #bdbdbd` sebagai border input | Kontras **1.88:1** — gagal WCAG 1.4.11 (batas kontrol butuh ≥3:1). Kotak input "hilang". | `outline: #757575` → **4.61:1** |
| 3 | Container max **1200px** fixed | Tabel pesanan/movement butuh lebar. 1200px memaksa scroll horizontal terus-menerus. | App shell fluid sampai **1600px**; 1200px hanya untuk halaman marketing/auth |
| 4 | Spacing `xs 4, sm 12, md 24, lg 40, xl 64` | Melompati 8 dan 16 — tidak ada langkah untuk kepadatan form/tabel operasional. | Skala lengkap `[0,4,8,12,16,24,32,40,48,64]` |

Tambahan yang belum ada di spec awal tapi wajib untuk aplikasi operasional:
`success` (status selesai sepanjang alur fulfillment), `focus-ring` (navigasi keyboard),
`density` (tabel panjang), state `disabled`/`loading`/`error`/`empty`, breakpoint responsif,
dan aturan ikon.

## 2. Aturan keras (non-negotiable)

1. **Dilarang gradient.** Tidak ada `linear-gradient`, `radial-gradient`, `conic-gradient`,
   `background-clip: text`, maupun glow/blur berlapis. Kedalaman hanya dari `elevation`.
   (Saat ini ada 1 pelanggaran: `src/app/page.tsx:27`.)
2. **Dilarang emoji sebagai ikon.** Tidak ada emoji di navigasi, tombol, badge, toast, empty
   state, judul halaman, tabel, maupun komentar yang ter-render. (Saat ini ada **147 kemunculan
   emoji di 21 file**.) Semua ikon berasal dari **lucide-react** — sudah terpasang di
   `package.json`, jadi tidak ada dependensi baru.
3. **Dilarang shadow ganda** pada satu elemen.
4. **Dilarang radius > 8px** kecuali badge/pill/avatar/status-dot (`full`).
5. **Merah hanya untuk aksi/peringatan/error.** Merah tidak dipakai untuk fokus, link netral,
   atau dekorasi.
6. **Status tidak pernah disampaikan lewat warna saja** — selalu ikon + teks (12-UX.md §6).
7. **Tidak ada nilai literal** di komponen. Semua lewat token/CSS variable.

## 3. Warna

Palet berakar pada tone hangat berkontras tinggi yang membangun rasa percaya dan mendorong aksi.

- **primary `#ee4d2d`** — satu-satunya warna CTA utama per layar. Catatan kontras jujur:
  putih di atas `#ee4d2d` = **3.66:1**, lulus AA hanya untuk teks besar/bold ≥18.66px (atau ≥14px bold).
  Untuk teks CTA 14px, gunakan `button-primary-strong` (`#d0011b`, **5.67:1**).
  Ini bukan preferensi estetika — ini syarat lulus audit aksesibilitas.
- **secondary `#0046ab`** — aksi pendukung, tautan, dan **cincin fokus**. Kontras 8.51:1.
- **tertiary `#eda500`** — peringatan/penawaran. Sebagai teks di atas putih hanya 2.10:1,
  jadi **tidak pernah dipakai sebagai warna teks di atas putih**. Dipakai sebagai latar badge
  dengan teks `#212121`, atau sebagai teks `#7a5300` di atas putih.
- **error `#ee2c4a`** — kegagalan. Sebagai teks di atas putih 4.12:1, jadi teks error memakai
  `on-error-container #b3122f`. Sebagai latar tombol destruktif, `#ee2c4a` dengan teks putih
  4.12:1 (lulus untuk teks ≥16px bold).
- **success `#1a7f4b`** (baru) — "selesai", "cocok", "terkirim". Kontras 5.02:1 di atas putih (lulus AA).

### Peta status → token

Warna status **tidak** memakai hex ad-hoc (saat ini `#fca5a5`, `#fcd34d`, `#a5b4fc` dipakai
langsung di `globals.css:91-94`).

| Status domain | Badge | Warna teks | Ikon pendamping |
|---|---|---|---|
| `CRITICAL` (order) / `EXCEPTION` | badge-danger | `on-error-container` | `AlertOctagon` |
| `HIGH` | badge-warning | `on-tertiary-container` | `AlertTriangle` |
| `MEDIUM` | badge-secondary | `on-secondary-container` | `Info` |
| `LOW` | badge-neutral | `on-surface-variant` | `Minus` |
| `COMPLETED` / `RESTOCKED` / `DELIVERED` | badge-success | `on-success-container` | `CheckCircle2` |
| `WAITING_STOCK` / `PENDING` | badge-neutral | `on-surface-variant` | `Clock` |
| `CANCELLED` / `REJECTED` | badge-neutral | `on-surface-variant` | `XCircle` |
| `IN_TRANSIT` / `SHIPPED` | badge-secondary | `on-secondary-container` | `Truck` |

## 4. Tipografi

Roboto untuk seluruh UI (headline, label, body) dengan `system-ui` sebagai fallback.
**`SHPBurmese` dan `SHPKhmer` dihapus**: keduanya font proprietary Shopee, tidak boleh
didistribusikan, dan tidak menambah apa pun untuk teks Bahasa Indonesia.
Roboto dimuat lewat `next/font/google` (`display: 'swap'`, subset `latin`) — tanpa CDN
runtime, tanpa FOUT.

Skala lengkap ada di frontmatter. Aturan pemakaian:

| Token | Dipakai untuk |
|---|---|
| `display` | Hanya hero/landing. **Tidak di app shell.** |
| `headline-lg` | Judul halaman (`/dashboard/pesanan`) |
| `headline-md` | Judul seksi besar |
| `title-lg` | Judul kartu / panel |
| `title-md` | Judul sub-seksi, judul modal |
| `body-lg` | Paragraf pengantar, teks form panjang |
| `body-md` | Body default, isi tabel |
| `label-md` | Tombol, tab, label form |
| `label-sm` | Badge, kolom header tabel, metadata |
| `code` | SKU, resi/AWB, order ID, request ID |

Jangan pernah memakai `text-shadow`/`drop-shadow` untuk teks.

## 5. Ikon — Lucide

**Library: `lucide-react`** (sudah ada di `package.json`, tree-shakeable, 1500+ ikon,
konsisten 24×24 grid, gaya outline — cocok dengan geometri Soft-Technical).

Ketentuan:
- `strokeWidth: 1.75` seragam. Ukuran 16/20/24/32 sesuai konteks.
- Ikon dekoratif: `aria-hidden="true"`. Ikon yang menjadi label satu-satunya: wajib `aria-label`.
- Dilarang mencampur library ikon lain, dilarang ikon filled+campur outline, dilarang SVG manual
  kecuali logo produk.

### Peta ikon navigasi (akhir dari emoji)

| Menu | Emoji saat ini | Lucide |
|---|---|---|
| Dashboard | `🏠` | `LayoutDashboard` |
| Pesanan | `📋` | `ShoppingCart` |
| Inventori | `📦` | `Boxes` |
| Fulfillment | `⚡` | `Workflow` |
| Scanner | `📱` | `ScanLine` |
| Pengiriman | `🚚` | `Truck` |
| Pengembalian | `↩️` | `Undo2` |
| Laporan | `📊` | `ChartColumn` |
| Integrasi | `🔗` | `Cable` |
| Pengaturan | `⚙️` | `Settings` |
| Keluar | `🚪` | `LogOut` |

### Peta ikon aksi & status

`Plus` (tambah) · `Pencil` (ubah) · `Trash2` (hapus) · `Search` (cari) · `SlidersHorizontal`
(filter) · `Download` (ekspor) · `Upload` (impor) · `RefreshCw` (sinkronkan ulang) · `Play`
(jalankan) · `Loader2` (loading, animasi spin) · `Check` (konfirmasi) · `X` (batal) ·
`ChevronRight`/`ChevronDown` (navigasi) · `ArrowUpDown` (urutkan) · `Clock` (menunggu) ·
`Timer` (SLA) · `AlertTriangle` (peringatan) · `AlertOctagon` (kritis) · `CheckCircle2` (sukses) ·
`XCircle` (gagal) · `Info` (informasi) · `CircleHelp` (bantuan) · `Lock`/`Unlock` ·
`Eye`/`EyeOff` (sandi) · `TriangleAlert` (bentrok stok) · `PackageSearch` (stok tidak ditemukan) ·
`Camera`/`Barcode`/`QrCode` (mode scan) · `Printer` (cetak label) · `MapPin` (alamat) ·
`Store` (toko) · `Plug`/`PlugZap` (status koneksi) · `ShieldCheck` (terverifikasi) ·
`CircleAlert` (banner peringatan) · `Inbox` (empty state) · `FileText` (laporan).

## 6. Layout & Responsif

App shell: **sidebar tetap + header lengket + konten fluid**.

```
┌──────────┬─────────────────────────────────────────────┐
│          │  App header (56px) — breadcrumb, sync, user │
│ Sidebar  ├─────────────────────────────────────────────┤
│ 240px    │  Page header — judul + aksi utama           │
│ sticky   │                                             │
│          │  Konten — tabel/kartu, max 1600px           │
└──────────┴─────────────────────────────────────────────┘
```

- **≤ 1023px (tablet):** sidebar menyusut jadi ikon 64px dengan tooltip.
- **≤ 767px (mobile):** sidebar menjadi drawer; header menampilkan tombol menu.
- **Prioritas mobile (12-UX.md §7):** alur gudang (Scanner, Fulfillment picking/packing)
  dioptimalkan untuk tablet/HP. Halaman manajemen (Laporan, Pengaturan) desktop-first
  tapi tetap tidak boleh overflow.
- Alur kerja gudang: **target sentuh minimum 44×44px**, tombol besar, fokus otomatis
  ke kolom scan, tanpa navigasi bersarang.
- Tabel panjang memakai `density: compact` (36px) dan sticky header; kolom numerik rata kanan.
- Setiap halaman responsif memakai grid 12 kolom dengan `gutter: 24px`.

## 7. Elevation, Gerak, dan Fokus

- **Elevation:** base `none` → kartu `sm` → hover `md` → modal/toast/dropdown `lg`.
  Satu elemen = satu shadow.
- **Gerak:** 120ms (hover/tombol), 200ms (dropdown/modal), 320ms (drawer).
  Easing `cubic-bezier(0.2,0,0,1)`. Hanya `opacity`, `color`, `box-shadow`, dan
  `transform` ≤2px. Hormati `prefers-reduced-motion: reduce` → durasi 0.
- **Fokus (wajib):** `:focus-visible` → `outline: 2px solid #0046ab; outline-offset: 2px`.
  Fokus **biru, bukan merah** — merah berarti bahaya. Jangan pernah `outline: none` tanpa pengganti.
  (Saat ini `globals.css:56-60` memakai `var(--primary)` = indigo, dan beberapa modal menghapus fokus.)

## 8. Aksesibilitas — hasil hitung kontras (WCAG 2.2 AA)

| Pasangan | Rasio | Hasil |
|---|---|---|
| `#ffffff` di atas `#ee4d2d` | 3.66:1 | Lulus AA hanya untuk teks besar (≥18.66px, atau ≥14px bold). Untuk CTA teks 14px pakai `#d0011b` (5.67:1) |
| `#ffffff` di atas `#d0011b` | 5.67:1 | Lulus AA |
| `#ffffff` di atas `#0046ab` | 8.52:1 | Lulus AAA |
| `#212121` di atas `#eda500` | 7.65:1 | Lulus AAA |
| `#7a5300` di atas `#ffffff` | 6.85:1 | Lulus AA |
| `#b3122f` di atas `#ffffff` | 6.90:1 | Lulus AA |
| `#1a7f4b` di atas `#ffffff` | 5.02:1 | Lulus AA. Untuk teks mikro (<12px) pakai `#0f5c35` (8.07:1) |
| `#595959` di atas `#ffffff` | 7.00:1 | Lulus AA |
| `#757575` di atas `#ffffff` | 4.61:1 | Lulus AA + batas kontrol lulus 3:1 |
| ~~`#ffffff` di atas `#eda500`~~ | ~~2.10:1~~ | **Gagal — dihapus** |
| ~~`#bdbdbd` di atas `#ffffff`~~ | ~~1.88:1~~ | **Gagal untuk batas kontrol — dihapus** |
| `#ee4d2d` di atas `#fef6f5` | 3.44:1 | Jangan pakai untuk teks <14px bold; `primary-container` hanya latar dekoratif |

Selain kontras: navigasi keyboard penuh, urutan tab logis, skip-link ke konten,
`aria-live="polite"` untuk hasil scan & toast, `aria-label` pada ikon, dan setiap pesan error
terikat ke field-nya lewat `aria-describedby`.

## 9. Brand & Legal

- Aplikasi ini **mengadopsi palet warna** Shopee untuk konsistensi rasa produk, tetapi **bukan**
  produk resmi Shopee.
- **Dilarang** memakai logo Shopee, `icon_favicon_1_96`, nama dagang "Shopee" sebagai identitas
  aplikasi, atau mengklaim afiliasi resmi. Hapus `logo.src` milik Shopee dari spec.
- Sinkronisasi dilakukan lewat **Shopee Open Platform API resmi** dengan kredensial partner
  yang dimiliki pengguna. Semua data berasal dari API tersebut dan dicatat jejaknya
  (`sync_runs`, `webhook_events`).
- Nama produk di UI: **E-Fulfill Hub** dengan label "Terhubung ke Shopee" hanya pada
  status koneksi, bukan sebagai branding.

## 10. Do's and Don'ts

**Do**
- Pakai `primary` hanya untuk satu CTA terprioritas per layar.
- Pakai `elevation.md` saat hover kartu yang bisa diklik; jangan ganti warna atau tambah border.
- Jaga ritme 24px antar seksi, 12px antar item terkait, 8px di dalam komponen padat.
- Pakai Roboto untuk semua teks UI.
- Selalu sertakan state **loading (skeleton)**, **empty**, **error**, dan **tanpa izin**
  untuk setiap halaman berdata (12-UX.md §9).
- Untuk aksi destruktif (sesuaikan stok, putus integrasi, batalkan pesanan) → dialog konfirmasi
  eksplisit dengan tombol destruktif berwarna `error`, bukan merah primary.

**Don't**
- Jangan pakai `secondary`/`tertiary` sebagai CTA utama.
- Jangan pakai gradient, glow, glassmorphism, atau `backdrop-filter` blur.
- Jangan pakai emoji.
- Jangan pakai lebih dari satu shadow per elemen.
- Jangan melebihi radius 8px (kecuali badge/pill/avatar).
- Jangan pakai `text-shadow`/`drop-shadow` pada body copy.
- Jangan menulis hex/px literal di komponen — hanya token.
- Jangan menampilkan angka palsu/demo saat API gagal. Tampilkan error state + tombol coba lagi.
