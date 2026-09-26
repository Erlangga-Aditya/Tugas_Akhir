#!/usr/bin/env python3
"""
Deploy E-Fulf Hub ke VPS Ubuntu — otomatis, satu perintah.

Yang dilakukan:
  1. Memasang Node.js 22, MySQL 8, Nginx, Certbot, PM2 (lewat deploy/setup-vps.sh)
  2. Membuat database + pengguna database dengan sandi acak
  3. Mengunggah berkas aplikasi (tanpa node_modules/.next/.env) ke /opt/efulfill/app
  4. Menulis .env produksi (sandi acak; kredensial Shopee disalin dari .env lokal)
  5. Memasang dependensi, migrasi database, seed produksi, lalu build
  6. Menjalankan aplikasi dengan PM2 (otomatis hidup lagi setelah server restart)
  7. Memasang Nginx + sertifikat SSL (Let's Encrypt)
  8. Memeriksa hasilnya dari luar

Jalankan (sandi TIDAK ditulis ke file mana pun):
  SSHPASS='...' VPS_HOST=103.178.174.224 uv run --with paramiko python deploy/remote_deploy.py

Opsional:
  PUBLIC_HOST   host yang dipakai untuk aplikasi (default: 103-178-174-224.sslip.io)
  CERTBOT_EMAIL surel untuk notifikasi sertifikat SSL
"""
from __future__ import annotations

import io
import os
import secrets
import stat
import subprocess
import sys
import tarfile
from pathlib import Path

import paramiko

REPO = Path(__file__).resolve().parents[1]
HOST = os.environ.get("VPS_HOST", "103.178.174.224")
USER = os.environ.get("VPS_USER", "root")
PASSWORD = os.environ.get("SSHPASS")
PORT = int(os.environ.get("VPS_PORT", "22"))
PUBLIC_HOST = os.environ.get("PUBLIC_HOST", "103-178-174-224.sslip.io")
CERTBOT_EMAIL = os.environ.get("CERTBOT_EMAIL", "")

APP_DIR = "/opt/efulfill/app"
DB_NAME = "efulfillhub"
DB_USER = "efulfill"

if not PASSWORD:
    print("SSHPASS belum diisi.")
    sys.exit(1)


def log(msg: str) -> None:
    print(msg, flush=True)


def run(client: paramiko.SSHClient, cmd: str, *, label: str = "", check: bool = True, quiet: bool = False) -> str:
    if label:
        log(f"\n── {label} ──")
    _in, out, err = client.exec_command(cmd, timeout=3600, get_pty=False)
    buf: list[str] = []
    for line in iter(out.readline, ""):
        buf.append(line)
        if not quiet:
            print("   " + line.rstrip(), flush=True)
    errtext = err.read().decode("utf-8", "replace")
    code = out.channel.recv_exit_status()
    if errtext.strip() and not quiet:
        print("   [stderr] " + errtext.strip()[:2000], flush=True)
    if check and code != 0:
        raise RuntimeError(f"Perintah gagal (exit {code}): {cmd[:120]}\n{errtext[:2000]}")
    return "".join(buf)


def put_text(sftp: paramiko.SFTPClient, remote_path: str, content: str, mode: int = 0o600) -> None:
    with sftp.open(remote_path, "w") as fh:
        fh.write(content)
    sftp.chmod(remote_path, mode)


def read_local_env() -> dict[str, str]:
    """Baca .env lokal (hanya nama yang kita butuhkan) — nilainya tidak pernah dicetak."""
    wanted = {
        "SHOPEE_PARTNER_ID",
        "SHOPEE_PARTNER_KEY",
        "SHOPEE_API_HOST",
        "SHOPEE_SANDBOX_HOST",
    }
    values: dict[str, str] = {}
    env_path = REPO / ".env"
    if not env_path.exists():
        return values
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key = key.strip()
        if key in wanted:
            values[key] = val.strip().strip('"').strip("'")
    return values


def build_tarball() -> bytes:
    """Bungkus sumber aplikasi (tanpa node_modules/.next/.git/.env)."""
    skip_dirs = {"node_modules", ".next", ".git", "__pycache__", ".vitest", "coverage"}
    skip_files = {".env", ".env.local", ".env.production"}
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for path in REPO.rglob("*"):
            rel = path.relative_to(REPO)
            parts = set(rel.parts)
            if parts & skip_dirs:
                continue
            if path.name in skip_files:
                continue
            if path.is_file():
                tar.add(path, arcname=str(rel).replace("\\", "/"))
    return buf.getvalue()


def main() -> None:
    log(f"Menghubungi {HOST} …")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=20)
    log("Terhubung.")

    # ── 1. Instalasi dasar ───────────────────────────────────────────────
    sftp = client.open_sftp()
    setup_script = (REPO / "deploy" / "setup-vps.sh").read_text(encoding="utf-8")
    put_text(sftp, "/root/setup-vps.sh", setup_script, 0o700)
    run(client, "bash /root/setup-vps.sh", label="1/8 Memasang Node.js, MySQL, Nginx, Certbot, PM2")

    # ── 2. Database ───────────────────────────────────────────────────────
    db_password = secrets.token_hex(16)
    run(
        client,
        "mysql -e \"CREATE DATABASE IF NOT EXISTS %s CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\""
        % DB_NAME,
        label="2/8 Membuat database",
    )
    run(
        client,
        "mysql -e \"CREATE USER IF NOT EXISTS '%s'@'localhost' IDENTIFIED BY '%s';\""
        % (DB_USER, db_password),
    )
    run(
        client,
        "mysql -e \"ALTER USER '%s'@'localhost' IDENTIFIED BY '%s';\""
        % (DB_USER, db_password),
    )
    run(
        client,
        "mysql -e \"GRANT ALL PRIVILEGES ON %s.* TO '%s'@'localhost'; FLUSH PRIVILEGES;\""
        % (DB_NAME, DB_USER),
        label="   pengguna database dibuat",
    )

    # ── 3. Unggah aplikasi ────────────────────────────────────────────────
    run(client, f"mkdir -p {APP_DIR}")
    log("\n── 3/8 Mengunggah berkas aplikasi ──")
    tarball = build_tarball()
    log(f"   ukuran paket: {len(tarball) / 1024 / 1024:.1f} MB")
    with sftp.open("/root/efulfill-app.tar.gz", "wb") as fh:
        fh.write(tarball)
    run(client, f"tar -xzf /root/efulfill-app.tar.gz -C {APP_DIR} && rm -f /root/efulfill-app.tar.gz")
    run(client, f"ls -1 {APP_DIR} | head -20", quiet=False)

    # ── 4. Berkas .env produksi ───────────────────────────────────────────
    local_env = read_local_env()
    jwt_secret = secrets.token_hex(32)
    encryption_key = secrets.token_hex(32)  # 64 karakter hex = 32 byte (AES-256-GCM)
    owner_password = "Toko" + secrets.token_urlsafe(9).replace("-", "x").replace("_", "y") + "9"

    env_lines = [
        "# Dibuat otomatis oleh deploy/remote_deploy.py — jangan dibagikan.",
        f'DATABASE_URL="mysql://{DB_USER}:{db_password}@localhost:3306/{DB_NAME}"',
        f'JWT_SECRET="{jwt_secret}"',
        'JWT_EXPIRES_IN="7d"',
        f'NEXT_PUBLIC_APP_URL="https://{PUBLIC_HOST}"',
        'APP_ENV="production"',
        f'ENCRYPTION_KEY="{encryption_key}"',
        f'SHOPEE_PARTNER_ID="{local_env.get("SHOPEE_PARTNER_ID", "")}"',
        f'SHOPEE_PARTNER_KEY="{local_env.get("SHOPEE_PARTNER_KEY", "")}"',
        f'SHOPEE_API_HOST="{local_env.get("SHOPEE_API_HOST", "https://partner.shopeemobile.com")}"',
        f'SHOPEE_SANDBOX_HOST="{local_env.get("SHOPEE_SANDBOX_HOST", "https://openplatform.sandbox.test-stable.shopee.sg")}"',
        'SHOPEE_SANDBOX="true"',
        f'SHOPEE_REDIRECT_URL="https://{PUBLIC_HOST}/api/v1/integrations/shopee/callback"',
        'AUTO_SYNC_ENABLED="true"',
        'AUTO_SYNC_INTERVAL_MS="60000"',
        'NODE_ENV="production"',
    ]
    put_text(sftp, f"{APP_DIR}/.env", "\n".join(env_lines) + "\n", 0o600)
    log("\n── 4/8 Berkas .env produksi ditulis (hak akses hanya root) ──")

    # ── 5. Pasang dependensi, migrasi, seed, build ────────────────────────
    run(client, f"cd {APP_DIR} && npm ci --no-audit --no-fund", label="5/8 Memasang dependensi (npm ci)")
    run(client, f"cd {APP_DIR} && npx prisma generate", label="   menyiapkan Prisma")
    run(client, f"cd {APP_DIR} && npx prisma migrate deploy", label="   migrasi database")
    run(
        client,
        f"cd {APP_DIR} && SEED_OWNER_EMAIL='owner@toko.id' SEED_OWNER_PASSWORD='{owner_password}' npx tsx prisma/seed-production.ts",
        label="   seed produksi (akun pemilik + gudang)",
    )
    run(client, f"cd {APP_DIR} && npm run build", label="   build aplikasi (produksi)")

    # ── 6. PM2 ────────────────────────────────────────────────────────────
    run(client, "pm2 delete efulfill >/dev/null 2>&1 || true")
    run(client, f"cd {APP_DIR} && pm2 start npm --name efulfill -- start", label="6/8 Menjalankan aplikasi (PM2)")
    run(client, "pm2 save")
    run(client, "pm2 startup systemd -u root --hp /root | tail -n 1", quiet=True)
    run(client, "systemctl enable pm2-root >/dev/null 2>&1 || true")

    # ── 7. Nginx + SSL ────────────────────────────────────────────────────
    nginx_conf = (REPO / "deploy" / "nginx-efulfill.conf").read_text(encoding="utf-8").replace(
        "__HOST__", PUBLIC_HOST
    )
    put_text(sftp, "/etc/nginx/sites-available/efulfill", nginx_conf, 0o644)
    run(
        client,
        "ln -sf /etc/nginx/sites-available/efulfill /etc/nginx/sites-enabled/efulfill && "
        "rm -f /etc/nginx/sites-enabled/default && nginx -t && systemctl reload nginx",
        label="7/8 Nginx dipasang",
    )
    email_flag = f"-m {CERTBOT_EMAIL}" if CERTBOT_EMAIL else "--register-unsafely-without-email"
    run(
        client,
        f"certbot --nginx -d {PUBLIC_HOST} --non-interactive --agree-tos {email_flag} --redirect",
        label="   sertifikat SSL (Let's Encrypt)",
        check=False,
    )
    run(client, "systemctl list-timers certbot.timer --no-pager | head -3", quiet=True)

    # ── 8. Pemeriksaan ────────────────────────────────────────────────────
    log("\n── 8/8 Pemeriksaan hasil ──")
    checks = [
        ("aplikasi lokal (PM2)", "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/login"),
        ("halaman masuk via HTTPS", f"curl -s -o /dev/null -w '%{{http_code}}' https://{PUBLIC_HOST}/login"),
        ("status PM2", "pm2 jlist | jq -r '.[] | \"\\(.name) \\(.pm2_env.status)\"' 2>/dev/null || pm2 status"),
        ("sertifikat", f"echo | openssl s_client -connect {PUBLIC_HOST}:443 -servername {PUBLIC_HOST} 2>/dev/null | openssl x509 -noout -subject -dates"),
    ]
    for title, cmd in checks:
        res = run(client, cmd, quiet=True)
        log(f"   {title}: {res.strip()[:200]}")

    sftp.close()
    client.close()

    log("\n" + "=" * 64)
    log("DEPLOY SELESAI")
    log(f"  Alamat aplikasi : https://{PUBLIC_HOST}")
    log(f"  Login pemilik   : owner@toko.id")
    log(f"  Kata sandi      : {owner_password}")
    log(f"  Folder aplikasi : {APP_DIR}")
    log(f"  Jalankan ulang  : cd {APP_DIR} && pm2 restart efulfill")
    log("=" * 64)
    log("CATATAN: ganti kata sandi root VPS sekarang (sandi tadi terkirim lewat chat).")
    log("         Perintah: passwd root")


if __name__ == "__main__":
    main()
