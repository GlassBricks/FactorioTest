#!/usr/bin/env bash
set -euo pipefail

worktree_path="$1"

cd "$worktree_path"
npm ci
