#!/bin/sh
# Runs before nginx starts (the base image runs everything in /docker-entrypoint.d, then execs
# nginx). A non-zero exit stops the container, so a bad setting never serves the wrong config.
#
# Shell image: MFE_ENV picks /opt/mfe/configs/runtime-config.$MFE_ENV.json and it is copied to
#   $MFE_RUNTIME_DIR/runtime-config.json. A runtime-config.json already in that folder (a mounted
#   ConfigMap) wins and MFE_ENV is not needed.
# Remote image: SHELL_ORIGINS (space or comma separated origins) become the CORS allow-list.
set -eu

runtime="${MFE_RUNTIME_DIR:-/tmp/mfe-runtime}"
configs="${MFE_CONFIGS_DIR:-/opt/mfe/configs}"

fail() {
  echo "mfe: $*" >&2
  exit 1
}

write_cors() {
  mkdir -p "$runtime"
  out="$runtime/cors-origins.map"
  : > "$out" || fail "cannot write $out; make /tmp writable"
  for origin in $(echo "$1" | tr ',' ' '); do
    case "$origin" in
      http://* | https://*) ;;
      *) fail "SHELL_ORIGINS entry '$origin' is not an origin like https://shop.example.com" ;;
    esac
    case "$origin" in
      *[!A-Za-z0-9.:/_-]* | */*/*/*) fail "SHELL_ORIGINS entry '$origin' is not a plain origin (no path, no spaces)" ;;
    esac
    printf '"%s" "%s";\n' "$origin" "$origin" >> "$out"
  done
  echo "mfe: CORS allowed for $(echo "$1" | tr ',' ' ')"
}

pick_runtime_config() {
  if [ -f "$runtime/runtime-config.json" ]; then
    echo "mfe: using the runtime-config.json already in $runtime"
    return
  fi
  if [ -n "${MFE_ENV:-}" ]; then
    chosen="$configs/runtime-config.$MFE_ENV.json"
    if [ ! -f "$chosen" ]; then
      echo "mfe: no runtime config for MFE_ENV=$MFE_ENV. Available:" >&2
      ls "$configs" >&2
      exit 1
    fi
  elif [ -f "$configs/runtime-config.json" ]; then
    chosen="$configs/runtime-config.json"
  else
    fail "set MFE_ENV to pick a runtime config, or mount runtime-config.json in $runtime"
  fi
  mkdir -p "$runtime"
  cp "$chosen" "$runtime/runtime-config.json" || fail "cannot write $runtime; make /tmp writable"
  echo "mfe: runtime config from $chosen"
}

if [ -d "$configs" ] && [ -n "$(ls "$configs" 2>/dev/null)" ]; then
  pick_runtime_config
elif [ -n "${SHELL_ORIGINS:-}" ]; then
  write_cors "$SHELL_ORIGINS"
fi
