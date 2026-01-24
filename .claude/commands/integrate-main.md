---
allowed-tools:
  - Bash(git worktree list:*)
  - Bash(git rebase:*)
  - Bash(git checkout:*)
  - Bash(git merge:*)
---

Check if using worktrees: !`git worktree list`
Rebase current branch onto main: !`git rebase main`
Switch to main and merge: `cd (main worktree)` or `git checkout main`, then `git merge --ff-only <current-branch>`
If rebase or merge fails: fix conflicts and retry
