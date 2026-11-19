#!/bin/bash
# Publica no Cloudflare Pages (https://ternura.pages.dev).
# Embute public/ dentro do _worker.js, porque da nuvem do Claude o upload de assets falha (401).
set -e
cd "$(dirname "$0")"
python3 - public publicar-nuvem/assets.mjs <<'PY'
import os, json, sys, base64
pub, out = sys.argv[1], sys.argv[2]; m = {}
for r, _, fs in os.walk(pub):
    for f in fs:
        p = os.path.join(r, f); k = "/" + os.path.relpath(p, pub).replace(os.sep, "/")
        b = open(p, "rb").read()
        m[k] = ["t", b.decode("utf-8")] if f.endswith((".html", ".css", ".js", ".json", ".svg", ".txt")) else ["b", base64.b64encode(b).decode()]
open(out, "w").write("export default " + json.dumps(m) + ";\n")
PY
rm -rf dist && mkdir dist
npx -y esbuild@0.24.2 publicar-nuvem/entrada.mjs --bundle --format=esm --platform=neutral --outfile=dist/_worker.js --log-level=warning
# Publica pela API (o wrangler tenta enviar assets e falha na nuvem)
curl -sS -X POST "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID:-28c5a93978be4b13500580ad082dd599}/pages/projects/ternura/deployments" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN:-proxy-injected}" --form-string 'manifest={}' --form-string 'branch=main' \
  -F '_worker.js=@dist/_worker.js;type=application/javascript+module;filename=_worker.js' | python3 -c "import json,sys;d=json.load(sys.stdin);print('ok' if d['success'] else d['errors'], (d.get('result') or {}).get('url',''))"
