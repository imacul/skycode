#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/imacul/skycode.git"
INSTALL_ROOT="$HOME/.skycode/app"
BIN_DIR="$HOME/.local/bin"
SHIM="$BIN_DIR/skycode"
UPDATE_SETTINGS="$HOME/.skycode/update.json"

step() {
  printf '\033[36m[SkyCode]\033[0m %s\n' "$1"
}

local_version() {
  if [ ! -f "$INSTALL_ROOT/package.json" ]; then
    printf 'unknown'
    return
  fi
  bun -e "const p=await Bun.file('$INSTALL_ROOT/package.json').json(); console.log(p.version ?? 'unknown')" 2>/dev/null || printf 'unknown'
}

write_shim() {
  mkdir -p "$BIN_DIR"
  cat > "$SHIM" <<'EOF'
#!/usr/bin/env bash
set -e

case "${1:-}" in
  update)
    exec bash "$HOME/.skycode/app/update.sh" "$@"
    ;;
  -v|--version|version)
    if [ -f "$HOME/.skycode/app/package.json" ]; then
      v="$(grep -m1 '"version"' "$HOME/.skycode/app/package.json" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
      printf 'SkyCode v%s\n' "$v"
    else
      printf 'SkyCode version unknown\n'
    fi
    exit 0
    ;;
esac

exec bun "$HOME/.skycode/app/packages/cli/src/index.tsx" "$@"
EOF
  chmod +x "$SHIM"
}

args=("$@")
flags=" ${args[*]:-} "

if [[ "$flags" == *" --no-auto "* ]]; then
  mkdir -p "$(dirname "$UPDATE_SETTINGS")"
  printf '{\n  "autoUpdate": false\n}\n' > "$UPDATE_SETTINGS"
  echo "Automatic SkyCode updates disabled."
  exit 0
fi

if [[ "$flags" == *" --auto "* ]]; then
  mkdir -p "$(dirname "$UPDATE_SETTINGS")"
  printf '{\n  "autoUpdate": true\n}\n' > "$UPDATE_SETTINGS"
  echo "Automatic SkyCode updates enabled."
fi

if ! command -v git >/dev/null 2>&1; then
  echo "SkyCode update failed: Git is required." >&2
  exit 1
fi

if [[ "$flags" == *" --check "* ]]; then
  if [ ! -d "$INSTALL_ROOT/.git" ]; then
    echo "SkyCode managed install is missing or incomplete."
    echo "Run the official installer once to repair it."
    exit 1
  fi

  current_sha="$(git -C "$INSTALL_ROOT" rev-parse HEAD)"
  remote_sha="$(git ls-remote "$REPO_URL" refs/heads/main | awk '{print $1}')"

  if [ -z "$remote_sha" ]; then
    echo "Could not check for updates. GitHub may be unreachable."
    exit 1
  fi

  version="$(local_version)"
  if [ "$current_sha" = "$remote_sha" ]; then
    echo "SkyCode v$version is up to date."
  else
    echo "SkyCode update available: ${remote_sha:0:7}"
    echo "Run 'skycode update' to install it."
  fi
  exit 0
fi

if ! command -v bun >/dev/null 2>&1; then
  step "Bun not found. Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

if ! bun -e 'const [a,b,c]=Bun.version.split(".").map(Number); process.exit(a>1 || (a===1 && (b>4 || (b===4 && c>=0))) ? 0 : 1)' >/dev/null 2>&1; then
  step "Bun is too old. Upgrading Bun..."
  bun upgrade
fi

mkdir -p "$(dirname "$INSTALL_ROOT")"

if [ -d "$INSTALL_ROOT/.git" ]; then
  step "Fetching the latest SkyCode..."
  git -C "$INSTALL_ROOT" fetch origin main
  git -C "$INSTALL_ROOT" checkout main
  git -C "$INSTALL_ROOT" reset --hard origin/main
else
  step "Managed install is missing. Recreating it..."
  rm -rf "$INSTALL_ROOT"
  git clone "$REPO_URL" "$INSTALL_ROOT"
fi

step "Installing dependencies..."
(
  cd "$INSTALL_ROOT"
  bun install
)

write_shim

printf '\033[32mSkyCode updated successfully.\033[0m\n'
printf 'Current version: v%s\n' "$(local_version)"
