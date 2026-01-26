#!/bin/bash
set -e

DRY_RUN=""
PACKAGES=()

for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN="--dry-run"
      echo "==> DRY RUN MODE"
      ;;
    types|mod|cli)
      PACKAGES+=("$arg")
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: $0 [--dry-run] [types] [mod] [cli]"
      exit 1
      ;;
  esac
done

if [ ${#PACKAGES[@]} -eq 0 ]; then
  PACKAGES=(types mod cli)
fi

echo "==> Running checks (lint, test, integration)..."
npm run check

for pkg in "${PACKAGES[@]}"; do
  case "$pkg" in
    types)
      echo "==> Publishing types..."
      npm publish -w types $DRY_RUN
      ;;
    mod)
      echo "==> Publishing mod..."
      if [ -n "$DRY_RUN" ]; then
        echo "(skipping fmtk publish in dry-run mode)"
      else
        (cd mod && npx fmtk publish)
      fi
      ;;
    cli)
      echo "==> Publishing cli..."
      npm publish -w cli $DRY_RUN
      ;;
  esac
done

echo "==> SUCCESS: Published ${PACKAGES[*]}"
