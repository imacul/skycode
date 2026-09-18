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

step "Installing SkyCode to $INSTALL_ROOT"
mkdir -p "$(dirname "$INSTALL_ROOT")"

if [ -d "$INSTALL_ROOT/.git" ]; then
  git -C "$INSTALL_ROOT" fetch origin main
  git -C "$INSTALL_ROOT" checkout main
  git -C "$INSTALL_ROOT" pull --ff-only origin main
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
printf '  skycode resume\n\n'
printf 'Run this same installer command again whenever you want to update.\n'