#!/usr/bin/env python3
"""
Survei VPS untuk deployment E-Fulf Hub.

Sandi TIDAK disimpan di file ini — dibaca dari variabel lingkungan SSHPASS.
Jalankan:  SSHPASS='...' VPS_HOST=103.178.174.224 uv run --with paramiko python deploy/vps_survey.py
"""
import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "103.178.174.224")
USER = os.environ.get("VPS_USER", "root")
PASSWORD = os.environ.get("SSHPASS")
PORT = int(os.environ.get("VPS_PORT", "22"))

if not PASSWORD:
    print("SSHPASS belum diisi.")
    sys.exit(1)

CHECKS: list[tuple[str, str]] = [
    ("SISTEM OPERASI", "cat /etc/os-release 2>/dev/null | head -3; uname -m"),
    ("CPU / RAM / DISK", "nproc; free -h | head -2; df -h / | tail -1"),
    ("NODE.JS", "node -v 2>/dev/null || echo 'BELUM ADA'"),
    ("NPM", "npm -v 2>/dev/null || echo 'BELUM ADA'"),
    ("MYSQL/MARIADB", "mysql --version 2>/dev/null || mariadb --version 2>/dev/null || echo 'BELUM ADA'"),
    ("SERVICE MYSQL", "systemctl is-active mysql 2>/dev/null || systemctl is-active mariadb 2>/dev/null || echo 'tidak aktif / belum ada'"),
    ("NGINX", "nginx -v 2>&1 || echo 'BELUM ADA'"),
    ("CERTBOT (SSL)", "which certbot || echo 'BELUM ADA'"),
    ("PM2", "pm2 -v 2>/dev/null || echo 'BELUM ADA'"),
    ("DOCKER", "docker --version 2>/dev/null || echo 'BELUM ADA'"),
    ("FIREWALL", "ufw status 2>/dev/null | head -4 || echo 'ufw tidak ada'"),
    ("PORT TERBUKA", "ss -tlnp 2>/dev/null | head -12"),
    ("ISI /opt & /var/www", "ls -1 /opt 2>/dev/null; echo '---'; ls -1 /var/www 2>/dev/null"),
    ("AKSES INTERNET VPS", "curl -s -m 8 ifconfig.me || echo gagal; echo"),
    ("TIMEZONE", "timedatectl 2>/dev/null | head -3 || date"),
]

try:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=20)
except Exception as exc:  # noqa: BLE001
    print(f"GAGAL TERHUBUNG ke {HOST}:{PORT} sebagai {USER}: {exc}")
    sys.exit(2)

print(f"TERHUBUNG ke {HOST} sebagai {USER}\n" + "=" * 60)
for title, cmd in CHECKS:
    _stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
    out = (stdout.read() + stderr.read()).decode("utf-8", "replace").strip()
    print(f"\n### {title}\n{out if out else '(kosong)'}")

client.close()
