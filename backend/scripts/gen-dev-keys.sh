#!/usr/bin/env bash
# Generate a dev-only RS256 keypair for JWT signing (backend/.keys, gitignored).
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY_DIR="$BACKEND_DIR/.keys"
PRIVATE_KEY="$KEY_DIR/jwt-private.pem"
PUBLIC_KEY="$KEY_DIR/jwt-public.pem"

if [[ -f "$PRIVATE_KEY" && -f "$PUBLIC_KEY" ]]; then
  echo "[gen-dev-keys] keys already exist at $KEY_DIR — skipping"
  exit 0
fi

mkdir -p "$KEY_DIR"
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$PRIVATE_KEY" 2>/dev/null
openssl pkey -in "$PRIVATE_KEY" -pubout -out "$PUBLIC_KEY" 2>/dev/null
chmod 600 "$PRIVATE_KEY"
echo "[gen-dev-keys] generated RSA-2048 keypair in $KEY_DIR"
