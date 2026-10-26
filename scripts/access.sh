#!/usr/bin/env bash
# リハーサル環境（Cloudflare Access の後ろ）を読む。合言葉は持たず、root 所有の入口に頼むだけ。
#   npm run see -- /input-shuho/api/engine
#   npm run see -- --site /
# 仕組みは ops/shuho-access と docs/OPERATIONS.md「私（Claude）からリハーサル環境を見る」を参照。
set -euo pipefail
if ! command -v shuho-access >/dev/null 2>&1; then
  echo '入口が未設置です: /usr/local/bin/shuho-access（docs/OPERATIONS.md「私（Claude）からリハーサル環境を見る」の設置手順）' >&2
  exit 2
fi
exec sudo -n shuho-access "$@"
