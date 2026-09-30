#!/usr/bin/env python3
"""
Diagnosa VPS: memeriksa keadaan aplikasi, database, dan kesiapan otorisasi Shopee.

Jalankan:
  SSHPASS='...' uv run --with paramiko python deploy/diagnose-vps.py
"""
import os
import paramiko

HOST = os.environ.get("VPS_HOST", "103.178.174.224")
USER = os.environ.get("VPS_USER", "root")
PASSWORD = os.environ.get("SSHPASS")

STEPS: list[tuple[str, str]] = [
    ("STATUS APLIKASI", "pm2 status --no-color | head -8"),
    ("LOG APLIKASI (60 baris terakhir, tanpa query rutin)",
     "grep -viE 'prisma:query' /root/.pm2/logs/efulfill-out.log /root/.pm2/logs/efulfill-error.log 2>/dev/null | tail -40"),
    ("PENJADWAL SINKRONISASI",
     "grep -i 'sinkronisasi otomatis\\|sync selesai\\|sync:' /root/.pm2/logs/efulfill-out.log 2>/dev/null | tail -6"),
    ("DATABASE: jumlah data",
     "mysql -N -e \"SELECT CONCAT('pesanan=',(SELECT COUNT(*) FROM orders),"
     " ' | toko=',(SELECT COUNT(*) FROM shops),"
     " ' | koneksi_shopee=',(SELECT COUNT(*) FROM integration_connections),"
     " ' | pengguna=',(SELECT COUNT(*) FROM users) FROM dual;\" efulfillhub"),
    ("DATABASE: koneksi Shopee (status & token)",
     "mysql -e \"SELECT shop_id, provider, status, sandbox, last_sync_at, IF(encrypted_credentials IS NULL,'KOSONG','ADA TOKEN') AS token FROM integration_connections;\" efulfillhub"),
    ("DATABASE: toko & external shop id",
     "mysql -e \"SELECT id, name, provider, external_shop_id, status FROM shops;\" efulfillhub"),
    ("DATABASE: sinkronisasi terakhir",
     "mysql -e \"SELECT operation, status, records_read, records_written, error_message, started_at FROM sync_runs ORDER BY started_at DESC LIMIT 5;\" efulfillhub"),
    ("KONFIGURASI SHOPEE DI SERVER (tanpa kunci rahasia)",
     "grep -E 'SHOPEE_REDIRECT_URL|SHOPEE_SANDBOX=|SHOPEE_API_HOST|SHOPEE_SANDBOX_HOST|NEXT_PUBLIC_APP_URL' /opt/efulfill/app/.env"),
    ("URL OTORISASI YANG DIBUAT APLIKASI",
     "cd /opt/efulfill/app && curl -s -c /tmp/c.txt -X POST http://127.0.0.1:3000/api/v1/auth/login "
     "-H 'Content-Type: application/json' -d '{\"email\":\"owner@toko.id\",\"password\":\"'\"$SEED_OWNER_PASSWORD\"'\"}' >/dev/null; "
     "curl -s -b /tmp/c.txt 'http://127.0.0.1:3000/api/v1/integrations/shopee/auth-url' | head -c 600"),
    ("JANGKAUAN KE SERVER SHOPEE (sandbox & produksi)",
     "curl -s -o /dev/null -w 'sandbox=%{http_code} ' https://openplatform.sandbox.test-stable.shopee.sg/ ; "
     "curl -s -o /dev/null -w 'produksi=%{http_code}\\n' https://partner.shopeemobile.com/"),
    ("BERKAS MESIN SCAN KAMERA DI HASIL BUILD (zxing)",
     "grep -rl 'zxing\\|BrowserMultiFormatReader' /opt/efulfill/app/.next/static 2>/dev/null | head -3 | sed 's|/opt/efulfill/app/||' ; "
     "echo \"potongan berkas: $(grep -rl 'zxing' /opt/efulfill/app/.next/static 2>/dev/null | wc -l)\""),
    ("HTTPS & SERTIFIKAT",
     "curl -s -o /dev/null -w 'https=%{http_code} ssl_verify=%{ssl_verify_result}\\n' https://103-178-174-224.sslip.io/login"),
    ("WEBHOOK: percobaan masuk",
     "grep -icE 'webhook' /root/.pm2/logs/efulfill-out.log 2>/dev/null | sed 's/^/baris webhook: /'"),
]


def main() -> None:
    if not PASSWORD:
        raise SystemExit("SSHPASS belum diisi.")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=20)
    for title, cmd in STEPS:
        _in, out, err = client.exec_command(cmd, timeout=60)
        text = (out.read() + err.read()).decode("utf-8", "replace").strip()
        print(f"\n### {title}\n{text if text else '(kosong)'}")
    client.close()


if __name__ == "__main__":
    main()
