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

CLI_VERSION=""
if [[ " ${PACKAGES[*]} " =~ " cli " ]]; then
  CLI_VERSION=$(node -p "require('./cli/package.json').version")
  CLI_TAG="cli-v$CLI_VERSION"

  if git rev-parse "$CLI_TAG" >/dev/null 2>&1; then
    echo "ERROR: Tag $CLI_TAG already exists. Bump cli version before publishing."
    exit 1
  fi

  if ! grep -q "^## Unreleased" cli/CHANGELOG.md; then
    echo "ERROR: cli/CHANGELOG.md must have an '## Unreleased' section"
    exit 1
  fi
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
      echo "==> Updating cli changelog..."
      sed -i "s/^## Unreleased$/## v$CLI_VERSION/" cli/CHANGELOG.md
      git add cli/CHANGELOG.md
      git commit -m "Release CLI v$CLI_VERSION"

      echo "==> Publishing cli..."
      if npm publish -w cli $DRY_RUN; then
        if [ -z "$DRY_RUN" ]; then
          echo "==> Creating tag $CLI_TAG..."
          git tag "$CLI_TAG"
        fi
      else
        echo "ERROR: npm publish failed"
        exit 1
      fi
      ;;
  esac
done

echo "==> SUCCESS: Published ${PACKAGES[*]}"
