#!/usr/bin/env bash
# Cek layout di HP sungguhan — dipakai cron berkala.
#
# Keluaran KOSONG = tidak ada yang perlu dilaporkan (semua bersih, atau HP
# sedang tidak terhubung). Hanya masalah layout yang benar-benar terukur yang
# dicetak, supaya cron tidak berisik.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 0

ADB="adb"
if ! command -v adb >/dev/null 2>&1; then
  ADB="/c/Users/SDM/AppData/Local/Microsoft/WinGet/Packages/Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe/platform-tools/adb.exe"
fi
[ -x "$ADB" ] || [ -f "$ADB" ] || exit 0

# HP tidak terhubung → diam (bukan kegagalan layout).
if ! "$ADB" devices 2>/dev/null | grep -q "device$"; then
  exit 0
fi

"$ADB" forward tcp:9222 localabstract:chrome_devtools_remote >/dev/null 2>&1 || exit 0

# Jalankan audit pada dua lebar paling umum.
HASIL=$(node scripts/hp-layout-audit.mjs 360 393 2>&1)
STATUS=$?

if [ "$STATUS" -ne 0 ]; then
  echo "Pemeriksaan layout HP menemukan masalah:"
  echo "$HASIL" | sed -n '/RINGKASAN/,$p'
  echo
  echo "$HASIL" | grep -E "^GESER|meluber=" | head -20
fi

exit 0
