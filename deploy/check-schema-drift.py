#!/usr/bin/env python3
"""
Pemeriksa kesesuaian database dengan skema Prisma (khusus tipe kolom panjang).

Latar belakang: pernah terjadi kolom token terenkripsi dibuat VARCHAR(191) oleh
migrasi lama padahal skema meminta TEXT, sehingga otorisasi Shopee gagal menyimpan
token dan tampak "gagal" padahal di sisi Shopee berhasil. Pemeriksa ini memastikan
setiap kolom @db.Text di schema.prisma benar-benar bertipe keluarga TEXT di database.

Jalankan:
  python3 deploy/check-schema-drift.py                     (di folder aplikasi)
  SKEMA=/opt/efulfill/app/prisma/schema.prisma python3 ...
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

SCHEMA = Path(os.environ.get("SKEMA", "prisma/schema.prisma"))
DB = os.environ.get("DB", "efulfillhub")
TEXT_FAMILY = ("text", "tinytext", "mediumtext", "longtext")


def parse_schema(schema_text: str) -> list[tuple[str, str]]:
    """Kembalikan daftar (tabel, kolom) untuk setiap kolom @db.Text."""
    hasil: list[tuple[str, str]] = []
    blok = re.findall(r"model (\w+) \{(.*?)\n\}", schema_text, flags=re.DOTALL)
    for nama_model, isi in blok:
        map_tabel = re.search(r'@@map\("([^"]+)"\)', isi)
        tabel = map_tabel.group(1) if map_tabel else nama_model
        for baris in isi.splitlines():
            if "@db.Text" not in baris:
                continue
            map_kolom = re.search(r'@map\("([^"]+)"\)', baris)
            kolom = map_kolom.group(1) if map_kolom else baris.strip().split()[0]
            hasil.append((tabel, kolom))
    return hasil


def tipe_kolom_di_db() -> dict[str, str]:
    mysql = shutil.which("mysql") or "mysql"
    query = (
        "SELECT CONCAT(TABLE_NAME, '.', COLUMN_NAME, '=', COLUMN_TYPE) "
        f"FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='{DB}'"
    )
    proc = subprocess.run([mysql, "-N", "-u", "root", "-e", query], capture_output=True, text=True)
    if proc.returncode != 0:
        print(f"Gagal membaca database: {proc.stderr.strip()[:400]}")
        sys.exit(2)
    hasil = {}
    for baris in proc.stdout.splitlines():
        if "=" in baris:
            k, v = baris.split("=", 1)
            hasil[k.strip()] = v.strip().lower()
    return hasil


def main() -> int:
    if not SCHEMA.exists():
        print(f"Schema tidak ditemukan: {SCHEMA}")
        return 2

    kolom = parse_schema(SCHEMA.read_text(encoding="utf-8"))
    if not kolom:
        print("Tidak ada kolom @db.Text di schema.")
        return 0

    tipe_db = tipe_kolom_di_db()
    print(f"Memeriksa {len(kolom)} kolom @db.Text pada database '{DB}'")
    print("=" * 72)
    rusak = 0
    for tabel, kolom_nama in kolom:
        kunci = f"{tabel}.{kolom_nama}"
        tipe = tipe_db.get(kunci)
        if tipe is None:
            print(f"  [TIDAK ADA]  {kunci} belum ada di database")
            rusak += 1
        elif tipe in TEXT_FAMILY:
            print(f"  [OK]         {kunci} = {tipe}")
        else:
            print(f"  [SALAH TIPE] {kunci} = {tipe}  (seharusnya TEXT)")
            rusak += 1
    print("=" * 72)
    print(
        f"HASIL: {rusak} kolom bermasalah — jalankan migrasi perbaikan."
        if rusak
        else "HASIL: semua kolom panjang sudah sesuai skema."
    )
    return 1 if rusak else 0


if __name__ == "__main__":
    sys.exit(main())
