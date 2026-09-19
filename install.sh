#!/usr/bin/env bash
set -euo pipefail

REPO="https://github.com/imacul/skycode.git"
INSTALL_ROOT="$HOME/.skycode/app"
BIN_DIR="$HOME/.local/bin"
SHIM="$BIN_DIR/skycode"

step() {
  printf '\033[36m[SkyCode]\033[0m %s\n' "$1"
}

if ! command -v git >/dev/null 2>&1; then
  echo "Git is required. Install Git, then run this installer again." >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  step "Bun not found. Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

if ! bun -e 'const [a,b,c]=Bun.version.split(".").map(Number); process.exit(a>1 || (a===1 && (b>4 || (b===4 && c>=0))) ? 0 : 1)' >/dev/null 2>&1; then
  step "Your Bun version is too old for SkyCode. Upgrading Bun..."
  bun upgrade
fi

step "Using Bun $(bun --version)"

step "Installing SkyCode to $INSTALL_ROOT"
mkdir -p "$(dirname "$INSTALL_ROOT")"

if [ -d "$INSTALL_ROOT/.git" ]; then
  git -C "$INSTALL_ROOT" fetch origin main
  git -C "$INSTALL_ROOT" checkout main
  # The install directory is managed by SkyCode. Resetting avoids failures
  # after an upstream history rewrite and removes generated-file drift.
  git -C "$INSTALL_ROOT" reset --hard origin/main
else
  rm -rf "$INSTALL_ROOT"
  git clone "$REPO" "$INSTALL_ROOT"
fi

step "Installing dependencies..."
(
  cd "$INSTALL_ROOT"
  bun install
)

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

if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  shell_name="$(basename "$SHELL")"
  case "$shell_name" in
    zsh) profile="$HOME/.zshrc" ;;
    bash) profile="$HOME/.bashrc" ;;
    *) profile="$HOME/.profile" ;;
  esac
  printf '\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$profile"
  export PATH="$BIN_DIR:$PATH"
  step "Added ~/.local/bin to PATH in $profile"
fi

printf '\n\033[32mSkyCode installed successfully.\033[0m\n'
printf 'Run:\n'
printf '  skycode\n'
printf '  skycode resume\n'
printf '  skycode update\n\n'
printf 'The update/version commands are bootstrap-safe and do not load the SkyCode app, so they can repair a broken release.\n'
printf 'SkyCode checks for updates automatically. Use "skycode update --auto" to opt into automatic installation.\n'