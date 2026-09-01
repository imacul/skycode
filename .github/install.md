# Quick Install

## Short URL (Recommended)
```bash
curl -fsSL https://git.io/skycode | bash
```

## Full URL
```bash
curl -fsSL https://raw.githubusercontent.com/imacul/skycode/main/install.sh | bash
```

## What This Does
1. Installs Bun (if not already installed)
2. Clones Sky Code repository
3. Installs all dependencies
4. Starts Sky Code

## Manual Installation
```bash
git clone https://github.com/imacul/skycode.git
cd skycode
bun install
bun run dev:cli
```
