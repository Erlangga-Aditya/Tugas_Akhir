"""
Deploy & verifikasi VPS lewat SSH password (paramiko).

Dipakai karena kunci publik mesin ini ditolak server, dan `sshpass` tidak
tersedia di Git-Bash Windows. Password dibaca dari environment `VPS_PASS`
(tidak ditulis ke berkas mana pun).

Pakai:
  VPS_PASS='...' uv run --with paramiko python scripts/vps-deploy-paramiko.py deploy
  VPS_PASS='...' uv run --with paramiko python scripts/vps-deploy-paramiko.py verify
"""
import os
import sys

import paramiko

HOST = '103.178.174.224'
USER = 'root'
APP_DIR = '/opt/efulfill/app'
# Python di Windows tidak mengenal /tmp (itu path MSYS). Berkas lokal memakai
# path Windows yang bisa dibaca os.stat().
LOCAL_TAR = os.environ.get('LOCAL_TAR', os.path.join(os.environ.get('TEMP', '.'), 'ef8.tgz'))


def koneksi() -> paramiko.SSHClient:
    password = os.environ.get('VPS_PASS')
    if not password:
        raise SystemExit('VPS_PASS belum diisi')
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=password, timeout=25, banner_timeout=40, auth_timeout=40)
    return client


def jalankan(client: paramiko.SSHClient, perintah: str, batas: int = 900) -> tuple[int, str]:
    _, stdout, stderr = client.exec_command(perintah, timeout=batas, get_pty=True)
    keluar = stdout.read().decode(errors='replace')
    galat = stderr.read().decode(errors='replace')
    kode = stdout.channel.recv_exit_status()
    teks = (keluar + galat).strip()
    return kode, teks


def deploy(client: paramiko.SSHClient) -> int:
    sftp = client.open_sftp()
    sftp.put(LOCAL_TAR, '/tmp/ef8.tgz')
    sftp.close()
    print('tarball terkirim')

    perintah = (
        f'cd {APP_DIR} && '
        # Hapus dulu src/prisma di server: tar hanya menimpa berkas yang ada, sehingga berkas yang sudah DIHAPUS di repo akan tertinggal dan menggagalkan build.
        'rm -rf src prisma && tar xzf /tmp/ef8.tgz && '
        'npx prisma migrate deploy > /tmp/mig.log 2>&1; echo MIGRATE=$?; '
        'npx prisma generate > /tmp/gen.log 2>&1; echo GEN=$?; '
        'npm run build > /tmp/be.log 2>&1; echo BUILD_EXIT=$?; '
        'pm2 restart efulfill --update-env > /dev/null 2>&1; '
        'sleep 8; echo HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/login)'
    )
    kode, teks = jalankan(client, perintah)
    print(teks)
    if 'HEALTH=200' not in teks or 'BUILD_EXIT=0' not in teks:
        print('--- ekor log build ---')
        _, log = jalankan(client, 'tail -20 /tmp/be.log')
        print(log)
        return 1
    print('DEPLOY_OK')
    return 0


def verifikasi(client: paramiko.SSHClient) -> int:
    """Jalankan skrip pemeriksaan yang diminta (default: scan transisi)."""
    skrip = os.environ.get('VPS_SCRIPT', 'verify-scan-transit.sh')
    sftp = client.open_sftp()
    sftp.put(os.path.join('scripts', skrip), '/tmp/' + skrip)
    sftp.close()
    kode, teks = jalankan(client, 'bash /tmp/' + skrip)
    print(teks)
    return kode


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'deploy'
    c = koneksi()
    try:
        sys.exit(deploy(c) if mode == 'deploy' else verifikasi(c))
    finally:
        c.close()
