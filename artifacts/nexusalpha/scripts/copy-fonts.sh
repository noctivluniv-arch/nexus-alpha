#!/bin/bash
set -e
ASSETS_DIR="$(dirname "$0")/../dist/assets"
PNPM_STORE="$(dirname "$0")/../../../node_modules/.pnpm"
mkdir -p "$ASSETS_DIR"
find "$PNPM_STORE" -path "*@expo-google-fonts+inter*" -name "Inter_400Regular*.ttf" | head -1 | xargs -I{} cp {} "$ASSETS_DIR/"
find "$PNPM_STORE" -path "*@expo-google-fonts+inter*" -name "Inter_500Medium*.ttf" | head -1 | xargs -I{} cp {} "$ASSETS_DIR/"
find "$PNPM_STORE" -path "*@expo-google-fonts+inter*" -name "Inter_600SemiBold*.ttf" | head -1 | xargs -I{} cp {} "$ASSETS_DIR/"
find "$PNPM_STORE" -path "*@expo-google-fonts+inter*" -name "Inter_700Bold*.ttf" | head -1 | xargs -I{} cp {} "$ASSETS_DIR/"
find "$PNPM_STORE" -path "*@expo+vector-icons*" -name "Feather*.ttf" | head -1 | xargs -I{} cp {} "$ASSETS_DIR/"
echo "Done! Fonts copied:"
ls "$ASSETS_DIR" | grep -i "inter\|feather"
