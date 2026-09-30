'use client';

import { type ReactNode, useEffect } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
  Info,
  Zap,
  Circle,
  Inbox,
  CircleAlert,
  X,
  
  
  
} from 'lucide-react';

export type Tone = 'primary' | 'secondary' | 'warning' | 'danger' | 'success' | 'neutral';

const TONE_CLASS: Record<Tone, string> = {
  primary: 'badge-primary',
  secondary: 'badge-secondary',
  warning: 'badge-warning',
  danger: 'badge-danger',
  success: 'badge-success',
  neutral: 'badge-neutral',
};

const TONE_ICON: Record<Tone, typeof Info> = {
  primary: Zap,
  secondary: Info,
  warning: AlertTriangle,
  danger: AlertOctagon,
  success: CheckCircle2,
  neutral: Circle,
};

/** Indonesian labels + tone for every domain status (single source of truth). */
const STATUS_LABELS: Record<string, { label: string; tone: Tone }> = {
  // Order
  NEW: { label: 'Baru Masuk', tone: 'neutral' },
  CONFIRMED: { label: 'Perlu Diproses', tone: 'warning' },
  CANCELLED: { label: 'Dibatalkan', tone: 'neutral' },
  COMPLETED: { label: 'Selesai', tone: 'success' },
  // Fulfillment
  WAITING_STOCK: { label: 'Menunggu Stok', tone: 'warning' },
  READY_TO_PICK: { label: 'Siap Dikemas', tone: 'secondary' },
  PICKING: { label: 'Sedang Dikemas', tone: 'primary' },
  PICKED: { label: 'Barang Lengkap', tone: 'secondary' },
  PACKING: { label: 'Dikemas', tone: 'primary' },
  PACKED: { label: 'Sudah Dikemas', tone: 'secondary' },
  READY_TO_SHIP: { label: 'Siap Kirim', tone: 'primary' },
  HANDED_OVER: { label: 'Diserahkan ke Kurir', tone: 'success' },
  EXCEPTION: { label: 'Perlu Diperiksa', tone: 'danger' },
  // Shipment
  PENDING: { label: 'Tertunda', tone: 'neutral' },
  PICKED_UP: { label: 'Diambil Kurir', tone: 'secondary' },
  IN_TRANSIT: { label: 'Dalam Perjalanan', tone: 'secondary' },
  DELIVERED: { label: 'Terkirim', tone: 'success' },
  FAILED: { label: 'Gagal', tone: 'danger' },
  RETURNED: { label: 'Dikembalikan', tone: 'neutral' },
  // Return
  REQUESTED: { label: 'Diajukan', tone: 'neutral' },
  IN_TRANSIT_RETURN: { label: 'Dalam Perjalanan', tone: 'secondary' },
  /** Paket retur benar-benar sudah tiba di gudang (sudah dicatat barangnya). */
  ARRIVED: { label: 'Sudah Sampai Gudang', tone: 'success' },
  RECEIVED: { label: 'Diterima', tone: 'secondary' },
  INSPECTION: { label: 'Inspeksi', tone: 'warning' },
  RESTOCKED: { label: 'Restok', tone: 'success' },
  DAMAGED: { label: 'Rusak', tone: 'danger' },
  REJECTED: { label: 'Ditolak', tone: 'danger' },
  CLOSED: { label: 'Ditutup', tone: 'neutral' },
  // Priority
  CRITICAL: { label: 'Kritis', tone: 'danger' },
  HIGH: { label: 'Tinggi', tone: 'warning' },
  MEDIUM: { label: 'Sedang', tone: 'secondary' },
  LOW: { label: 'Rendah', tone: 'neutral' },
  // Order item
  RESERVED: { label: 'Terpesan', tone: 'secondary' },
  FULFILLED: { label: 'Terpenuhi', tone: 'success' },
  // Movement
  RECEIVE: { label: 'Stok Masuk', tone: 'success' },
  RESERVE: { label: 'Reservasi', tone: 'neutral' },
  RESERVE_RELEASE: { label: 'Lepas Reservasi', tone: 'neutral' },
  DEDUCTION: { label: 'Stok Keluar', tone: 'danger' },
  ADJUSTMENT: { label: 'Penyesuaian', tone: 'warning' },
  RETURN_RESTOCK: { label: 'Retur Restok', tone: 'success' },
  RETURN_DAMAGED: { label: 'Retur Rusak', tone: 'danger' },
  BLOCKED: { label: 'Diblokir', tone: 'neutral' },
  UNBLOCKED: { label: 'Buka Blokir', tone: 'neutral' },
  // Inspection
  SELLABLE: { label: 'Layak Jual', tone: 'success' },
  PARTIAL: { label: 'Sebagian', tone: 'warning' },
  // Sync
  RUNNING: { label: 'Berjalan', tone: 'secondary' },
  PROCESSED: { label: 'Diproses', tone: 'success' },
  SKIPPED: { label: 'Dilewati', tone: 'neutral' },
  // Connection
  ACTIVE: { label: 'Aktif', tone: 'success' },
  INACTIVE: { label: 'Nonaktif', tone: 'neutral' },
  ERROR: { label: 'Error', tone: 'danger' },
};

export function statusMeta(status: string | null | undefined): { label: string; tone: Tone } {
  if (!status) return { label: '—', tone: 'neutral' };
  return STATUS_LABELS[status] ?? { label: status, tone: 'neutral' };
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const { label, tone } = statusMeta(status);
  const Icon = TONE_ICON[tone];
  return (
    <span className={`badge ${TONE_CLASS[tone]}`}>
      <Icon size={12} strokeWidth={2.2} aria-hidden />
      {label}
    </span>
  );
}

export function StatCard({
  value,
  label,
  hint,
  tone = 'neutral',
  href,
}: {
  value: ReactNode;
  label: string;
  hint?: string;
  tone?: Tone;
  href?: string;
}) {
  const accentColor =
    tone === 'danger'
      ? 'var(--error)'
      : tone === 'warning'
      ? 'var(--tertiary)'
      : tone === 'success'
      ? 'var(--success)'
      : tone === 'secondary'
      ? 'var(--secondary)'
      : 'var(--primary)';

  const valueColor =
    tone === 'danger'
      ? 'var(--on-error-container)'
      : tone === 'warning'
      ? 'var(--on-tertiary-container)'
      : tone === 'success'
      ? 'var(--on-success-container)'
      : tone === 'secondary'
      ? 'var(--on-secondary-container)'
      : 'var(--on-surface)';

  const inner = (
    <div
      className="stat-card"
      style={{ '--stat-accent': accentColor } as React.CSSProperties}
    >
      <div className="stat-header">
        <span className="stat-label">{label}</span>
      </div>
      <div>
        <div className="stat-value" style={{ color: valueColor }}>
          {value}
        </div>
        {hint ? <div className="stat-hint mt8">{hint}</div> : null}
      </div>
    </div>
  );

  return href ? (
    <Link href={href} style={{ color: 'inherit', display: 'block', height: '100%' }}>
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header-container">
      <div className="page-header-text">
        <h1 className="page-title">{title}</h1>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export function LoadingState({ message = 'Memuat data...' }: { message?: string }) {
  return (
    <div className="center-state">
      <div className="spinner" role="status" aria-label="Memuat" />
      <span style={{ fontSize: 13.5, fontWeight: 500 }}>{message}</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="center-state">
      <Inbox size={36} strokeWidth={1.5} style={{ opacity: 0.45 }} aria-hidden />
      <div style={{ fontWeight: 600, color: 'var(--on-surface)', fontSize: 15 }}>{title}</div>
      {description ? <div className="small muted" style={{ maxWidth: 360 }}>{description}</div> : null}
      {action ? <div className="mt8">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="center-state" style={{ borderColor: 'var(--error-border)' }}>
      <CircleAlert size={36} strokeWidth={1.5} style={{ color: 'var(--error)' }} aria-hidden />
      <div style={{ fontWeight: 600, color: 'var(--on-error-container)', fontSize: 15 }}>{message}</div>
      {onRetry ? (
        <button type="button" className="btn btn-secondary btn-sm mt8" onClick={onRetry}>
          Coba Lagi
        </button>
      ) : null}
    </div>
  );
}

export function Alert({
  tone,
  children,
}: {
  tone: 'info' | 'warning' | 'danger' | 'success';
  children: ReactNode;
}) {
  const Icon =
    tone === 'danger'
      ? AlertOctagon
      : tone === 'warning'
      ? AlertTriangle
      : tone === 'success'
      ? CheckCircle2
      : Info;
  return (
    <div className={`alert alert-${tone}`} role="status">
      <Icon size={18} strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden />
      <div className="grow">{children}</div>
    </div>
  );
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', onKeyDown);
    }
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--divider)' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>{title}</h2>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            aria-label="Tutup modal"
            style={{ padding: 4, height: 'auto' }}
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        <div style={{ padding: '20px' }}>{children}</div>
      </div>
    </div>
  );
}
