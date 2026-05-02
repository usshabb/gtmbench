#!/bin/sh
# Temporarily swap .env.local with the given env file, restoring on exit.
# Usage: sh with-env.sh <env-file> <command...>

ENV_FILE="$1"
shift

cp .env.local .env.local.bak 2>/dev/null
cp "$ENV_FILE" .env.local

cleanup() {
  if [ -f .env.local.bak ]; then
    mv .env.local.bak .env.local
  fi
}
trap cleanup EXIT INT TERM

"$@"
