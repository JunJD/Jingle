#!/bin/bash
# 安装 ljg-card 依赖
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CARD_DIR="$(dirname "$SCRIPT_DIR")/skills/ljg-card"

if [ -f "$CARD_DIR/package.json" ]; then
    echo "Installing ljg-card dependencies..."
    cd "$CARD_DIR"
    npm install
    npx playwright install chromium
    echo "ljg-card dependencies installed successfully."
else
    echo "Error: package.json not found in $CARD_DIR"
    exit 1
fi
