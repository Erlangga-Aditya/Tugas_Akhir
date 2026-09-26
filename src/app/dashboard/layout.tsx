'use client';

import { type ReactNode, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  ShoppingCart,
  Boxes,
  Truck,
  Undo2,
  ChartColumn,
  Cable,
  Settings,
  LogOut,
  PackageCheck,
  Package,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  UserCheck,
  Wallet,
} from 'lucide-react';
import { api } from '@/lib/api';
import { AutoSyncStatus } from '@/components/AutoSyncStatus';
import { PwaInstallPrompt } from '@/components/pwa-install-prompt';

/**
 * Menu dipertahankan sesedikit mungkin.
 * Halaman "Operasi Harian", "Fulfillment", dan "Scanner" sudah DIGABUNG ke
 * halaman "Pesanan" supaya operator hanya memakai satu alur kerja.
 */
const NAV_ITEMS = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Ringkasan' },
  { href: '/dashboard/pesanan', icon: ShoppingCart, label: 'Pesanan & Pengiriman' },
  { href: '/dashboard/inventori', icon: Boxes, label: 'Stok Gudang' },
  { href: '/dashboard/produk', icon: Package, label: 'Produk' },
  { href: '/dashboard/pengiriman', icon: Truck, label: 'Lacak Kiriman' },
  { href: '/dashboard/pengembalian', icon: Undo2, label: 'Pengembalian' },
  { href: '/dashboard/laporan', icon: ChartColumn, label: 'Laporan' },
  { href: '/dashboard/laporan-keuangan', icon: Wallet, label: 'Laporan Keuangan' },
  { href: '/dashboard/integrasi', icon: Cable, label: 'Hubungkan Shopee' },
  { href: '/dashboard/pengaturan', icon: Settings, label: 'Pengaturan' },
];

const FRESH_ORDER_MS = 5 * 60 * 1000; // pesanan baru < 5 menit → badge berdenyut

interface Me {
  user: { id: string; name: string; email: string } | null;
  tenantName: string | null;
  role: string | null;
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isDesktopCollapsed, setIsDesktopCollapsed] = useState(false);
  const [orderBadge, setOrderBadge] = useState<{
    count: number;
    newestOrderAt: string | null;
    isFresh: boolean;
  }>({ count: 0, newestOrderAt: null, isFresh: false });

  const fetchBadge = useCallback(() => {
    api<{ count: number; notQueued: number; newestOrderAt: string | null }>('/api/v1/orders/badge')
      .then((res) =>
        setOrderBadge({
          count: res.count,
          newestOrderAt: res.newestOrderAt,
          // Dihitung di callback, bukan saat render.
          isFresh: res.newestOrderAt
            ? Date.now() - new Date(res.newestOrderAt).getTime() < FRESH_ORDER_MS
            : false,
        }),
      )
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetchBadge();
    const onSynced = () => fetchBadge();
    window.addEventListener('shopee:synced', onSynced);
    const interval = setInterval(fetchBadge, 30000);
    return () => {
      window.removeEventListener('shopee:synced', onSynced);
      clearInterval(interval);
    };
  }, [fetchBadge]);

  const badgeIsFresh = orderBadge.isFresh;


  // Prevent body scroll when mobile drawer is open
  useEffect(() => {
    if (isMobileNavOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobileNavOpen]);

  useEffect(() => {
    api<Me>('/api/v1/auth/me').then(setMe).catch(() => setMe(null));
  }, []);

  async function handleLogout() {
    await fetch('/api/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.push('/login');
    router.refresh();
  }

  // Get readable current page context for topbar
  const currentItem = NAV_ITEMS.find(
    (item) => pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href)),
  );
  const currentPageTitle = currentItem ? currentItem.label : 'E-Fulfill Hub';

  return (
    <>
      <PwaInstallPrompt />
      <div className="dashboard-root">
        <div
          className={`sidebar-overlay ${isMobileNavOpen ? 'active' : ''}`}
          onClick={() => setIsMobileNavOpen(false)}
          aria-hidden="true"
        />

        {/* Sidebar Navigation */}
        <aside
          className={`sidebar ${isMobileNavOpen ? 'mobile-open' : ''} ${isDesktopCollapsed ? 'collapsed' : ''}`}
          aria-label="Navigasi Utama"
        >
          <div className="sidebar-brand">
          <Link href="/dashboard" className="sidebar-brand-content">
            <span className="sidebar-brand-logo">
              <PackageCheck size={20} aria-hidden />
            </span>
            <span className="sidebar-brand-title">E-Fulfill Hub</span>
          </Link>
          <button
            type="button"
            className="sidebar-close-btn"
            onClick={() => setIsMobileNavOpen(false)}
            aria-label="Tutup menu navigasi"
          >
            <X size={20} aria-hidden />
          </button>
          </div>

          <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href + '/'));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`sidebar-link ${active ? 'active' : ''}`}
                title={isDesktopCollapsed ? item.label : undefined}
                onClick={() => setIsMobileNavOpen(false)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Icon size={19} strokeWidth={active ? 2.2 : 1.75} aria-hidden />
                  <span>{item.label}</span>
                </div>
                {item.href === '/dashboard/pesanan' && orderBadge.count > 0 && (
                  <span
                    title={
                      badgeIsFresh
                        ? 'Ada pesanan baru masuk — segera proses'
                        : `${orderBadge.count} pesanan menunggu diselesaikan`
                    }
                    style={{
                      background: badgeIsFresh ? '#dc2626' : '#ef4444',
                      color: '#ffffff',
                      fontSize: 10.5,
                      fontWeight: 800,
                      padding: '2px 7px',
                      borderRadius: 12,
                      boxShadow: badgeIsFresh
                        ? '0 0 0 0 rgba(239, 68, 68, 0.7)'
                        : '0 0 8px rgba(239, 68, 68, 0.4)',
                      animation: badgeIsFresh ? 'pulse 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite' : undefined,
                    }}
                  >
                    {orderBadge.count > 99 ? '99+' : orderBadge.count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          {me?.user ? (
            <div className="mb12 user-info-text">
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--on-surface)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {me.user.name}
              </div>
              <div className="muted small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {me.tenantName ?? 'Toko Utama'}
              </div>
            </div>
          ) : null}
          <button
            type="button"
            onClick={handleLogout}
            className="btn btn-ghost"
            style={{ width: '100%', justifyContent: isDesktopCollapsed ? 'center' : 'flex-start', padding: isDesktopCollapsed ? '8px 0' : '8px 12px' }}
            title={isDesktopCollapsed ? 'Keluar' : undefined}
          >
            <LogOut size={16} aria-hidden />
            <span style={{ display: isDesktopCollapsed ? 'none' : 'inline' }}>Keluar</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className={`main-content ${isDesktopCollapsed ? 'collapsed' : ''}`}>
        <header className="topbar">
          <div className="topbar-left">
            {/* Mobile Hamburger Button */}
            <button
              type="button"
              className="hamburger-btn"
              onClick={() => setIsMobileNavOpen(true)}
              aria-label="Buka menu navigasi"
            >
              <Menu size={20} aria-hidden />
            </button>

            {/* Desktop Collapse / Expand Button */}
            <button
              type="button"
              className="desktop-collapse-btn"
              onClick={() => setIsDesktopCollapsed((prev) => !prev)}
              aria-label={isDesktopCollapsed ? 'Lebarkan sidebar' : 'Ciutkan sidebar'}
              title={isDesktopCollapsed ? 'Lebarkan sidebar' : 'Ciutkan sidebar'}
            >
              {isDesktopCollapsed ? <PanelLeftOpen size={18} aria-hidden /> : <PanelLeftClose size={18} aria-hidden />}
            </button>

            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--on-surface)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>{currentPageTitle}</span>
              </div>
              <div className="small muted topbar-subtitle" style={{ fontSize: 12 }}>
                {pathname === '/dashboard' ? 'Ringkasan operasional terpadu' : 'E-Fulfill Hub · Shopee Open Platform'}
              </div>
            </div>
          </div>

          <div className="topbar-right" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AutoSyncStatus />
            {me?.role ? (
              <span className="badge badge-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <UserCheck size={12} aria-hidden />
                {me.role}
              </span>
            ) : null}
          </div>
        </header>

        <main className="page-body">{children}</main>
      </div>
    </div>
    </>
  );
}
