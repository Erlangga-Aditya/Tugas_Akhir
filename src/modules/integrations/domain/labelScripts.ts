/**
 * Skrip Python yang dipakai membaca label PDF, ditanam sebagai teks.
 *
 * Kenapa ditanam, bukan dibaca dari berkas `.py` di sebelah modul ini:
 * di build produksi Next.js, `import.meta.url` menunjuk ke berkas HASIL BUNDEL
 * di `.next/server/...`, bukan ke `src/modules/...`. Berkas `.py` karena itu
 * tidak ditemukan, dan pemeriksaan barcode diam-diam selalu gagal di produksi
 * walaupun semua test lokal hijau.
 *
 * Dengan ditanam, hanya ada SATU sumber kebenaran dan tidak ada lagi
 * ketergantungan pada tata letak berkas hasil build. Isinya ditulis ke
 * direktori sementara saat benar-benar dipakai.
 *
 * Keduanya memerlukan PyMuPDF (`python3-pymupdf`); skrip deploy memastikan
 * paket itu ada.
 */

/**
 * Keluarkan setiap gambar yang tertanam di dalam PDF label.
 *
 * Barcode label Shopee disimpan sebagai objek gambar di dalam PDF, bukan
 * sebagai teks. Mengambil gambarnya langsung jauh lebih akurat daripada
 * merender seluruh halaman lalu menebak bagian mana barcode-nya: yang dibaca
 * hanya gambar itu sendiri, jadi teks, garis tabel, dan logo tidak mengganggu.
 */
export const EXTRACT_LABEL_IMAGES_PY = String.raw`#!/usr/bin/env python3
"""Keluarkan setiap gambar yang tertanam di dalam PDF label.

Menulis daftar gambar sebagai JSON ke stdout. Gambar disimpan di subdirektori
"img" di sebelah berkas PDF masukan.
"""
from __future__ import annotations

import json
import os
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print("pemakaian: <skrip> <berkas-pdf>", file=sys.stderr)
        return 2

    pdf_path = sys.argv[1]
    out_dir = os.path.join(os.path.dirname(pdf_path), "img")
    os.makedirs(out_dir, exist_ok=True)

    try:
        import pymupdf
    except ImportError:
        import fitz as pymupdf

    doc = pymupdf.open(pdf_path)
    images = []
    for page_index in range(doc.page_count):
        page = doc.load_page(page_index)
        for info in page.get_image_info(xrefs=True):
            xref = info.get("xref")
            if not xref:
                continue
            width = int(info.get("width", 0))
            height = int(info.get("height", 0))
            if width < 20 or height < 20:
                # Ikon kecil atau piksel dekoratif, bukan barcode.
                continue
            try:
                extracted = doc.extract_image(xref)
            except Exception:
                continue
            if not extracted:
                continue
            image = extracted["image"]
            ext = extracted.get("ext", "png")
            path = os.path.join(out_dir, "p%d-x%d.%s" % (page_index + 1, xref, ext))
            with open(path, "wb") as fh:
                fh.write(image)
            images.append(
                {
                    "page": page_index + 1,
                    "xref": xref,
                    "width": width,
                    "height": height,
                    "ext": ext,
                    "path": path,
                }
            )

    print(json.dumps({"count": len(images), "images": images}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
`;

/**
 * Baca teks yang tercetak di label, per halaman.
 *
 * Dipakai untuk mencari nomor resi sebagai TEKS. Kalau resi tercetak, operator
 * bisa membacanya sendiri tanpa bergantung pada pembaca barcode.
 */
export const READ_LABEL_TEXT_PY = String.raw`#!/usr/bin/env python3
"""Baca teks yang tercetak di setiap halaman label PDF.

Menulis {"pages": [...]} sebagai JSON ke stdout. JSON sengaja di-indent supaya
mudah dibaca manusia saat diperiksa manual.
"""
from __future__ import annotations

import json
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print("pemakaian: <skrip> <berkas-pdf>", file=sys.stderr)
        return 2

    pdf_path = sys.argv[1]
    try:
        import pymupdf
    except ImportError:
        import fitz as pymupdf

    doc = pymupdf.open(pdf_path)
    result = {"pages": []}

    for page_index in range(doc.page_count):
        page = doc.load_page(page_index)
        images = []
        for info in page.get_image_info(xrefs=True):
            w = int(info.get("width", 0))
            h = int(info.get("height", 0))
            if w < 20 or h < 20:
                continue
            images.append({"xref": info.get("xref"), "width": w, "height": h})
        result["pages"].append(
            {
                "page": page_index + 1,
                "width": int(page.rect.width),
                "height": int(page.rect.height),
                "text": page.get_text("text"),
                "images": images,
            }
        )

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
`;
