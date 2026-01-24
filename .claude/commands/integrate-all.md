---
allowed-tools:
  - Read(../**)
  - Write(../**)
  - Bash(git worktree list:*)
  - Bash(git rebase:*)
  - Bash(git merge:*)
  - Bash(git reset:*)
---

!`git worktree list`

Skip integrating or resetting a branch completely if it has any uncommitted changes.

For every non-main branch:

- Within the worktree, run `git rebase main`
- If rebase fails: fix conflicts and retry
- From main worktree, run `git merge --ff-only <branch>`
- Repeat for next branch (rebase onto updated main)

At end, reset all worktrees to new main using `git reset --hard main`
