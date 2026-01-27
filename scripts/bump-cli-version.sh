#!/bin/bash
set -e

if [ $# -ne 1 ]; then
  echo "Usage: $0 <patch|minor|major>"
  exit 1
fi

BUMP_TYPE="$1"

case "$BUMP_TYPE" in
  patch|minor|major)
    ;;
  *)
    echo "ERROR: Invalid bump type '$BUMP_TYPE'. Must be patch, minor, or major."
    exit 1
    ;;
esac

echo "==> Bumping CLI version ($BUMP_TYPE)..."
npm version "$BUMP_TYPE" --no-git-tag-version -w cli

NEW_VERSION=$(node -p "require('./cli/package.json').version")

echo "==> Committing version bump..."
git add cli/package.json package-lock.json
git commit -m "Bump CLI version to $NEW_VERSION"

echo "==> SUCCESS: CLI version bumped to $NEW_VERSION"
