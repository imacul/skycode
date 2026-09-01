#!/bin/bash

# Sky Code - One-command installer
# Run this to install and start Sky Code instantly

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if Bun is installed
check_bun() {
    if ! command -v bun &> /dev/null; then
        echo -e "${YELLOW}⚠️  Bun not found. Installing Bun...${NC}"
        curl -fsSL https://bun.sh/install | bash
        export PATH="$HOME/.bun/bin:$PATH"
        echo -e "${GREEN}✅ Bun installed!${NC}"
    fi
}

# Install Sky Code
install_skycode() {
    echo -e "${BLUE}🚀 Installing Sky Code...${NC}"
    
    # Clone repo
    if [ -d "skycode" ]; then
        echo -e "${YELLOW}⚠️  skycode directory exists. Updating...${NC}"
        cd skycode
        git pull origin main
    else
        git clone https://github.com/imacul/skycode.git
        cd skycode
    fi
    
    # Install dependencies
    echo -e "${BLUE}📦 Installing dependencies...${NC}"
    bun install
    
    echo -e "${GREEN}✅ Sky Code installed!${NC}"
}

# Run Sky Code
run_skycode() {
    echo -e "\n${GREEN}🎉 Starting Sky Code...${NC}"
    echo -e "${YELLOW}💡 Tip: Use /help for commands, /setup to configure API keys${NC}\n"
    bun run dev:cli
}

# Main
main() {
    echo -e "${BLUE}
  🌌 Sky Code - AI Agent Harness
  ===============================${NC}"
    echo -e "${YELLOW}Installing to current directory...${NC}\n"
    
    check_bun
    install_skycode
    run_skycode
}

# Check for --help or -h
if [[ "$1" == "--help" || "$1" == "-h" ]]; then
    echo "Usage: $(basename "$0") [options]"
    echo ""
    echo "Options:"
    echo "  --help, -h    Show this help message"
    echo "  --skip-pull   Skip pulling latest changes (use local)"
    echo ""
    echo "Quick Start:"
    echo "  curl -fsSL https://raw.githubusercontent.com/imacul/skycode/main/install.sh | bash"
    echo ""
    echo "Or use npx:"
    echo "  npx https://github.com/imacul/skycode raw"
    exit 0
fi

# Run main
main
