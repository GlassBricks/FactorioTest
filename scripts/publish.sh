#!/bin/bash
set -e

DRY_RUN=""
if [ "$1" = "--dry-run" ]; then
  DRY_RUN="--dry-run"
  echo "==> DRY RUN MODE"
fi

echo "==> Running checks (lint, test, integration)..."
npm run check

echo "==> Publishing types..."
npm publish -w types $DRY_RUN

echo "==> Publishing mod..."
if [ -n "$DRY_RUN" ]; then
  echo "(skipping fmtk publish in dry-run mode)"
else
  (cd mod && npx fmtk publish)
fi

echo "==> Publishing cli..."
npm publish -w cli $DRY_RUN

echo "==> SUCCESS: All packages published"
