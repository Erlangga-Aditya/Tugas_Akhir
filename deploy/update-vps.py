#!/usr/bin/env python3
"""
Perbarui aplikasi E-Fulf Hub di VPS setelah ada perubahan kode.

Berbeda dari remote_deploy.py (yang memasang dari nol), skrip ini hanya:
  1. Mengunggah berkas aplikasi terbaru (tanpa node_modules/.next/.env)
  2. Menjalankan migrasi database yang belum dijalankan
  3. Build ulang, lalu menyalakan ulang aplikasi (PM2)

Jalankan:
  SSHPASS='...' VPS_HOST=103.178.174.224 uv run --with paramiko python deploy/update-vps.py

Dependensi dipasang ulang otomatis bila package-lock.json berubah.
Tambahkan INSTALL=1 untuk memaksa memasang ulang tanpa perubahan apa pun.
"""
from __future__ import annotations

import hashlib
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
LOCK_PATH = REPO / "package-lock.json"
APP_DIR = "/opt/efulfill/app"
# Penanda hash package-lock.json yang terakhir benar-benar dipasang.
# Dipakai untuk memutuskan perlu-tidaknya npm ci; lihat komentar di main().
INSTALLED_MARKER = "/opt/efulfill/.installed-lock-hash"
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


def build_tarball_manifest() -> set[str]:
    """Daftar path yang ikut terkirim ke server (harus sama dengan isi tarball)."""
    paths: set[str] = set()
    skip_dirs = {"node_modules", ".next", ".git", "dist", "coverage", ".vercel"}
    skip_files = {".env", ".env.local", ".env.production", ".DS_Store"}
    for root, dirs, files in os.walk("."):
        rel_root = Path(root).resolve().relative_to(Path.cwd().resolve())
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        for name in files:
            rel = (rel_root / name).as_posix()
            if name in skip_files or rel.endswith((".log", ".tmp")):
                continue
            paths.add(rel.lstrip("./"))
    return paths


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

    # `tar -x` menimpa berkas yang ada, tapi TIDAK menghapus berkas yang di repo
    # sudah dihapus. Akibatnya file mati di server masih ikut ter-build. Contoh
    # nyata: src/app/api/v1/auth/register/route.ts masih ada setelah dihapus,
    # lalu build gagal dengan "Export registerUser doesn't exist in target
    # module" padahal di repo sudah bersih.
    #
    # Perbaikannya: sebelum menimpa, daftar dulu path yang dihapus di repo
    # (path yang ada di server tapi tidak ada di paket) lalu hapus. Src dan
    # prisma yang dibersihkan penuh karena itu yang dipakai build; berkas lain
    # (.env, log, upload) tidak boleh ikut terhapus.
    manifest = "\n".join(sorted(rel.replace("\\", "/") for rel in build_tarball_manifest()))
    with sftp.open("/root/efulfill-manifest.txt", "w") as fh:
        fh.write(manifest)

    sync_cmd = (
        f"cd {APP_DIR} && "
        # Path yang ada di server tapi tidak ada di paket = dihapus di repo.
        "find src prisma -type f | sort > /tmp/efulfill-on-server.txt && "
        "grep -E '^(src|prisma)/' /root/efulfill-manifest.txt | sort > /tmp/efulfill-in-package.txt && "
        "comm -23 /tmp/efulfill-on-server.txt /tmp/efulfill-in-package.txt > /tmp/efulfill-to-delete.txt && "
        "if [ -s /tmp/efulfill-to-delete.txt ]; then "
        "  echo 'Menghapus berkas yang sudah dihapus di repo:'; "
        "  xargs -a /tmp/efulfill-to-delete.txt -r -d '\n' rm -f; "
        "fi && "
        f"tar -xzf /root/efulfill-update.tar.gz -C {APP_DIR} && "
        "rm -f /root/efulfill-update.tar.gz /root/efulfill-manifest.txt"
    )
    run(client, sync_cmd, "1/5 Berkas diperbarui")

    # Deteksi perubahan package.json / package-lock.json. Tanpa ini, tambah
    # satu dependency baru (mis. pdf-lib) lolos ke server tapi tidak terpasang,
    # dan build gagal dengan "Cannot find module" yang jauh dari penyebabnya.
    #
    # Pembandingnya adalah PENANDA yang ditulis setiap kali npm ci selesai,
    # bukan berkas package-lock.json itu sendiri. Alasannya: tarball sudah
    # diekstrak di langkah sebelumnya, jadi package-lock.json di server sudah
    # identik dengan yang lokal - membandingkan keduanya SELALU cocok dan
    # dependensi baru tidak pernah terpasang. Penanda menyimpan hash berkas yang
    # benar-benar dipakai saat pemasangan terakhir, sehingga perbandingannya
    # tetap sahih walau urutan unggah berubah.
    local_lock_hash = hashlib.sha256(LOCK_PATH.read_bytes()).hexdigest()
    installed_hash = run(
        client,
        f"cat {INSTALLED_MARKER} 2>/dev/null || echo belum-pernah",
        "",
    ).strip()
    deps_changed = installed_hash != local_lock_hash
    if deps_changed:
        reason = "pertama kali" if installed_hash == "belum-pernah" else "package-lock.json berubah"
        print(f"   {reason} -> dependensi akan dipasang ulang")
    elif DO_INSTALL:
        deps_changed = True
        print("   INSTALL=1 diminta -> dependensi dipasang ulang")

    if deps_changed:
        run(client, f"cd {APP_DIR} && npm ci --no-audit --no-fund", "2/5 Memasang dependensi (npm ci)")
        # Penanda ditulis hanya SETELAH pemasangan berhasil, supaya kegagalan
        # tidak tercatat sebagai "sudah terpasang".
        run(
            client,
            f"echo {local_lock_hash} > {INSTALLED_MARKER}",
            "",
        )
    else:
        print("\n── 2/5 Memasang dependensi dilewati (dependensi sudah sesuai) ──")

    run(client, f"cd {APP_DIR} && npx prisma generate", "3/5 Menyiapkan Prisma")
    run(client, f"cd {APP_DIR} && npx prisma migrate deploy", "   migrasi database")

    # Pemeriksaan barcode label membaca PDF memakai PyMuPDF lewat python3.
    # Pustaka itu milik sistem, bukan npm, jadi `npm ci` tidak memasangnya dan
    # tanpa baris ini pemeriksaan barcode diam-diam selalu gagal di server
    # (ditandai "gagal-diperiksa") tanpa ada yang menyadari.
    run(
        client,
        "python3 -c 'import pymupdf' 2>/dev/null || "
        "DEBIAN_FRONTEND=noninteractive apt-get install -y python3-pymupdf",
        "   memastikan PyMuPDF tersedia",
    )
    # .next dibersihkan sebelum build: Turbopack menyimpan cache transformasi
    # di dalam .next, dan cache lama pernah referencing modul yang sudah
    # tidak ada sehingga build gagal padahal dependensinya sudah benar.
    run(client, f"cd {APP_DIR} && rm -rf .next && npm run build", "4/5 Build produksi")
    run(client, "pm2 restart efulfill && sleep 5 && pm2 status", "5/5 Menyalakan ulang aplikasi")

    print("\n── Pemeriksaan ──")
    print("   aplikasi lokal :", run(client, "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/login", "").strip())

    sftp.close()
    client.close()
    print("\nPEMBARUAN SELESAI.")


if __name__ == "__main__":
    main()
