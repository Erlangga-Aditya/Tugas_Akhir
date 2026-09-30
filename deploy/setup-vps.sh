#!/usr/bin/env bash
#
# Instalasi server untuk E-Fulf Hub (Ubuntu 22.04/24.04/26.04).
# Dijalankan SEKALI sebagai root di VPS.
#
#   bash setup-vps.sh
#
# Yang dipasang: Node.js 22 LTS, MySQL 8, Nginx, Certbot (SSL), PM2, firewall.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

echo "== 1/7 Pembaruan paket dasar =="
apt-get update -y
apt-get install -y curl ca-certificates gnupg git ufw jq openssl

echo "== 2/7 Node.js 22 LTS =="
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v
npm -v

echo "== 3/7 MySQL 8 =="
if ! command -v mysql >/dev/null 2>&1; then
  apt-get install -y mysql-server
fi
systemctl enable mysql
systemctl start mysql

echo "== 4/7 Nginx + Certbot =="
apt-get install -y nginx certbot python3-certbot-nginx
systemctl enable nginx
systemctl start nginx

echo "== 5/7 PM2 (penjaga aplikasi tetap hidup) =="
npm install -g pm2

echo "== 6/7 Zona waktu Asia/Jakarta (penting untuk tanggal pesanan & laporan) =="
timedatectl set-timezone Asia/Jakarta
date

echo "== 7/7 Firewall =="
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
ufw status

echo
echo "Instalasi dasar selesai."
echo "Node : $(node -v)"
echo "MySQL: $(mysql --version)"
echo "Nginx: $(nginx -v 2>&1)"
