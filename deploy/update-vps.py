#!/usr/bin/env python3
"""
Perbarui aplikasi E-Fulf Hub di VPS setelah ada perubahan kode.

Berbeda dari remote_deploy.py (yang memasang dari nol), skrip ini hanya:
  1. Mengunggah berkas aplikasi terbaru (tanpa node_modules/.next/.env)
  2. Menjalankan migrasi database yang belum dijalankan
  3. Build ulang, lalu menyalakan ulang aplikasi (PM2)

Jalankan:
  SSHPASS='...' VPS_HOST=103.178.174.224 uv run --with paramiko python deploy/update-vps.py

Tambahkan INSTALL=1 kalau ada perubahan paket di package.json (menjalankan npm ci).
"""
from __future__ import annotations

import io
import os
import sys
import tarfile
from pathlib import Path

import paramiko

REPO = Path(__file__).resolve().parents[1]
HOST = os.environ.get("VPS_HOST", "103.178.174.224")
USER = os.environ.get("VPS_USER", "root")
PASSWORD = os.environ.get("SSHPASS")
PORT = int(os.environ.get("VPS_PORT", "22"))
APP_DIR = "/opt/efulfill/app"
DO_INSTALL = os.environ.get("INSTALL") == "1"

if not PASSWORD:
    print("SSHPASS belum diisi.")
    sys.exit(1)


def run(client: paramiko.SSHClient, cmd: str, label: str = "") -> str:
    if label:
        print(f"\n── {label} ──", flush=True)
    _in, out, err = client.exec_command(cmd, timeout=3600)
    text = ""
    for line in iter(out.readline, ""):
        text += line
        print("   " + line.rstrip(), flush=True)
    errtext = err.read().decode("utf-8", "replace")
    code = out.channel.recv_exit_status()
    if code != 0:
        raise RuntimeError(f"Perintah gagal (exit {code}): {cmd[:100]}\n{errtext[:1500]}")
    return text


def build_tarball() -> bytes:
    skip_dirs = {"node_modules", ".next", ".git", "__pycache__", ".vitest", "coverage"}
    skip_files = {".env", ".env.local", ".env.production"}
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for path in REPO.rglob("*"):
            rel = path.relative_to(REPO)
            if set(rel.parts) & skip_dirs:
                continue
            if path.name in skip_files:
                continue
            if path.is_file():
                tar.add(path, arcname=str(rel).replace("\\", "/"))
    return buf.getvalue()


def main() -> None:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=20)
    sftp = client.open_sftp()

    print("Mengunggah berkas terbaru …")
    data = build_tarball()
    print(f"   paket: {len(data) / 1024 / 1024:.1f} MB")
    with sftp.open("/root/efulfill-update.tar.gz", "wb") as fh:
        fh.write(data)
    run(client, f"tar -xzf /root/efulfill-update.tar.gz -C {APP_DIR} && rm -f /root/efulfill-update.tar.gz", "1/5 Berkas diperbarui")

    if DO_INSTALL:
        run(client, f"cd {APP_DIR} && npm ci --no-audit --no-fund", "2/5 Memasang dependensi (npm ci)")
    else:
        print("\n── 2/5 Memasang dependensi dilewati (pakai INSTALL=1 bila package.json berubah) ──")

    run(client, f"cd {APP_DIR} && npx prisma generate", "3/5 Menyiapkan Prisma")
    run(client, f"cd {APP_DIR} && npx prisma migrate deploy", "   migrasi database")
    run(client, f"cd {APP_DIR} && npm run build", "4/5 Build produksi")
    run(client, "pm2 restart efulfill && sleep 5 && pm2 status", "5/5 Menyalakan ulang aplikasi")

    print("\n── Pemeriksaan ──")
    print("   aplikasi lokal :", run(client, "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/login", "").strip())

    sftp.close()
    client.close()
    print("\nPEMBARUAN SELESAI.")


if __name__ == "__main__":
    main()
