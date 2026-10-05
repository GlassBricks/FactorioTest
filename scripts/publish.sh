#!/bin/bash
set -euo pipefail

DRY_RUN=""
PACKAGES=()

usage() {
  echo "Usage: $0 [--dry-run] [types] [mod] [cli]"
}

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
      usage
      exit 1
      ;;
  esac
done

if [ ${#PACKAGES[@]} -eq 0 ]; then
  PACKAGES=(types mod cli)
fi

BRANCH=$(git branch --show-current)
CLI_VERSION=$(node -p "require('./cli/package.json').version")
CLI_TAG="cli-v$CLI_VERSION"
TYPES_VERSION=$(node -p "require('./types/package.json').version")
MOD_VERSION=$(node -p "require('./mod/info.json').version")
MOD_PUBLISH_BRANCH=$(node -p "require('./mod/info.json').package.git_publish_branch")

has_package() {
  [[ " ${PACKAGES[*]} " == *" $1 "* ]]
}

fail() {
  echo "ERROR: $1"
  exit 1
}

check_npm_unpublished() {
  local pkg="$1" version="$2"
  if [ -n "$(npm view "$pkg@$version" version 2>/dev/null)" ]; then
    fail "$pkg@$version is already published on npm. Bump the version."
  fi
  echo "    $pkg@$version not yet on npm"
}

check_mod_unpublished() {
  local releases
  releases=$(curl -fsS https://mods.factorio.com/api/mods/factorio-test) || fail "Could not query the mod portal"
  if echo "$releases" | node -e '
    const mod = JSON.parse(require("fs").readFileSync(0, "utf8"))
    process.exit(mod.releases.some((r) => r.version === process.argv[1]) ? 0 : 1)
  ' "$MOD_VERSION"; then
    fail "factorio-test $MOD_VERSION is already on the mod portal. Bump mod/info.json version."
  fi
  echo "    factorio-test $MOD_VERSION not yet on the mod portal"
}

check_clean_tree() {
  if [ -z "$(git status --porcelain)" ]; then
    return
  fi
  # fmtk publish silently exits 0 on a dirty tree
  if [ -n "$DRY_RUN" ]; then
    echo "WARNING: working tree is dirty (a real publish would fail)"
  else
    fail "Working tree is dirty. Commit or stash changes before publishing."
  fi
}

preflight() {
  echo "==> Preflight..."
  check_clean_tree

  if has_package types; then
    check_npm_unpublished factorio-test "$TYPES_VERSION"
  fi

  if has_package mod; then
    if [ "$BRANCH" != "$MOD_PUBLISH_BRANCH" ]; then
      fail "Mod must be published from branch '$MOD_PUBLISH_BRANCH' (current: '$BRANCH')"
    fi
    check_mod_unpublished
  fi

  if has_package cli; then
    if git rev-parse "$CLI_TAG" >/dev/null 2>&1; then
      fail "Tag $CLI_TAG already exists. Bump cli version before publishing."
    fi
    if ! grep -q "^## Unreleased" cli/CHANGELOG.md; then
      fail "cli/CHANGELOG.md must have an '## Unreleased' section"
    fi
    check_npm_unpublished factorio-test-cli "$CLI_VERSION"
  fi
}

publish_types() {
  echo "==> Publishing types $TYPES_VERSION..."
  npm publish -w types $DRY_RUN
}

package_mod_dry_run() {
  local outdir zip file_count
  outdir=$(mktemp -d)
  (cd mod && npx fmtk package --outdir "$outdir")
  zip="$outdir/factorio-test_$MOD_VERSION.zip"
  [ -f "$zip" ] || fail "Expected mod zip not found: $zip"

  file_count=$(unzip -Z1 "$zip" | grep -cv '/$')
  echo "    $zip ($(du -h "$zip" | cut -f1), $file_count files)"
  if unzip -Z1 "$zip" | grep -q '/node_modules/'; then
    fail "Mod zip contains node_modules/"
  fi
}

publish_mod() {
  echo "==> Publishing mod $MOD_VERSION..."
  if [ -n "$DRY_RUN" ]; then
    package_mod_dry_run
    return
  fi
  (cd mod && npx fmtk publish)
}

publish_cli() {
  echo "==> Publishing cli $CLI_VERSION..."
  if [ -n "$DRY_RUN" ]; then
    echo "    would release v$CLI_VERSION (changelog commit and tag $CLI_TAG)"
    npm publish -w cli --dry-run
    return
  fi

  sed -i "s/^## Unreleased$/## v$CLI_VERSION/" cli/CHANGELOG.md
  git add cli/CHANGELOG.md
  git commit -m "Release CLI v$CLI_VERSION"
  npm publish -w cli || fail "npm publish failed"
  git tag "$CLI_TAG"
  echo "==> Push the release commit and tag: git push origin $BRANCH $CLI_TAG"
}

preflight

echo "==> Running checks (lint, test, integration)..."
npm run check

for pkg in "${PACKAGES[@]}"; do
  "publish_$pkg"
done

echo "==> SUCCESS: Published ${PACKAGES[*]}${DRY_RUN:+ (dry run)}"
