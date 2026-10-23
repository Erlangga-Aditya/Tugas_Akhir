import pymupdf

MASALAH = []


def verifikasi(nama_file: str, harus_mendesak: bool):
    doc = pymupdf.open(nama_file)
    page = doc[0]
    W, H = page.rect.width, page.rect.height
    rows = []
    for blk in page.get_text("dict")["blocks"]:
        for line in blk.get("lines", []):
            spans = line.get("spans", [])
            if not spans:
                continue
            teks = "".join(s["text"] for s in spans).strip()
            if teks:
                rows.append({
                    "teks": teks,
                    "x0": min(s["bbox"][0] for s in spans),
                    "x1": max(s["bbox"][2] for s in spans),
                    "y0": min(s["bbox"][1] for s in spans),
                    "y1": max(s["bbox"][3] for s in spans),
                    "size": spans[0]["size"],
                })

    print(f"\n=== {nama_file}: {len(rows)} baris | {W:.0f}x{H:.0f}pt ===")
    txt = "\n".join(r["teks"] for r in rows)

    def cek(label, ok):
        print(("OK   " if ok else "GAGAL ") + label)
        if not ok:
            MASALAH.append(f"{nama_file}: {label}")

    # 1. Isi
    cek("section PALING DEKAT DIBATALKAN OTOMATIS", ("DIBATALKAN OTOMATIS" in txt) == harus_mendesak)
    cek("kolom Deadline + Sisa waktu", ("Deadline" in txt and "Sisa waktu" in txt) == harus_mendesak)
    cek("kolom Tanggal TIDAK ada", "Tanggal" not in txt)
    cek("tabel Produk/Qty ada", "Produk" in txt and "Qty" in txt)
    cek("tanda tangan TIDAK ada", "Diserahkan" not in txt and "____" not in txt and "__________" not in txt)

    # 2. Geometri: overflow margin
    for r in rows:
        if r["x1"] > W - 15:
            MASALAH.append(f"{nama_file}: overflow kanan {r['teks'][:24]!r} x1={r['x1']:.0f}")
        if r["x0"] < 15:
            MASALAH.append(f"{nama_file}: overflow kiri {r['teks'][:24]!r} x0={r['x0']:.0f}")
        if r["y1"] > H - 15:
            MASALAH.append(f"{nama_file}: terlalu dekat bawah {r['teks'][:24]!r}")

    # 3. Geometri: tumpang tindih vertikal (gunakan tinggi font sebagai ambang)
    for i in range(len(rows)):
        for j in range(i + 1, len(rows)):
            a, b = rows[i], rows[j]
            tumpang_x = min(a["x1"], b["x1"]) - max(a["x0"], b["x0"])
            tumpang_y = min(a["y1"], b["y1"]) - max(a["y0"], b["y0"])
            if tumpang_x > 2 and tumpang_y > 1.5:
                MASALAH.append(
                    f"{nama_file}: tumpang tindih {a['teks'][:18]!r} <> {b['teks'][:18]!r} (y={tumpang_y:.1f}pt)"
                )

    # 4. Urutan: section mendesak harus di atas tabel produk utama
    if harus_mendesak:
        y_mendesak = next((r["y0"] for r in rows if "DIBATALKAN OTOMATIS" in r["teks"]), None)
        y_tabel = [r["y0"] for r in rows if r["teks"].strip() == "Produk"]
        if y_mendesak is not None and y_tabel:
            cek("section mendesak di ATAS tabel produk", y_mendesak < max(y_tabel))
        for r in rows[:8]:
            print(f"  y={r['y0']:6.1f} size={r['size']:.1f}  {r['teks'][:46]}")


verifikasi("verify-pdf-output.pdf", True)
verifikasi("verify-pdf-kosong.pdf", False)

print("\n" + "=" * 60)
if MASALAH:
    print(f"HASIL: {len(MASALAH)} MASALAH DITEMUKAN")
    for m in MASALAH[:12]:
        print("  - " + m)
else:
    print("HASIL: SEMUA CEK LOLOS — TIDAK ADA MASALAH")
