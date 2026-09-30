# Testing Strategy

## 1. Testing pyramid

```text
             E2E
           /-----\
          /  API  \
         /---------\
        / Integration\
       /---------------\
      /      Unit       \
     /-------------------\
```

## 2. Unit tests
Target domain rules:
- available stock calculation
- reservation policy
- priority calculation
- state transitions
- return inspection outcomes

## 3. Integration tests
Target:
- repository behavior
- transaction behavior
- API authorization
- integration adapter mapping
- webhook idempotency

## 4. E2E tests
Critical paths (sesuai alur operator tunggal di `/dashboard/pesanan`):
1. Sinkronisasi pesanan dari Shopee (berjalan tiap 60 detik di server).
2. Ambil resi dari Shopee — **gagal harus dilaporkan jujur, tanpa nomor karangan**.
3. Gerbang resi: pemindai **harus** nomor resi; nomor pesanan tidak boleh menyelesaikan packing.
4. Scan resi → potong stok FIFO dari lot terlama.
5. Stok kurang → `WAITING_STOCK`, stok tidak berubah, perlu keputusan operator.
6. Scan ulang pesanan yang sudah dikemas → idempoten, stok tidak dipotong dua kali.
7. Serahkan ke kurir → `PACKED → READY_TO_SHIP → HANDED_OVER` dalam satu transaksi, tanpa deduction kedua.
8. Scan **dua operator bersamaan** → hanya satu yang berhasil memotong stok.
9. Terima pengembalian & stok kembali.

> Bukti eksekusi ada di `docs/riwayat-pengujian.md`. Skipped bukan lulus.

## 5. Acceptance criteria example

### Priority queue
Given:
- order A deadline 1 hour
- order B deadline 8 hours
- both have stock

When queue is calculated

Then:
- both appear in the queue
- A has higher urgency according to the configured rule
- explanation is available

Do not hard-code a "winner" in research documentation; the result depends on the configured criteria and measured data.

## 6. Performance checks
Measure:
- order list response
- inventory lookup
- scan validation
- queue calculation
- sync processing time

Use realistic test volumes.

## 7. Security tests
At minimum:
- unauthorized access
- cross-tenant access
- invalid role
- malformed input
- replayed webhook
- duplicate idempotency key
- secret exposure checks

## 8. Research evaluation
Recommended:
- pre/post task time
- error count
- SUS usability questionnaire
- user task completion rate

The research report must clearly distinguish observed measurements from assumptions.
