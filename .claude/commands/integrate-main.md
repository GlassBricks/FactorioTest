---
allowed-tools:
  - Bash(hack/integrate-main.sh:*)
  - Bash(git rebase:*)
  - Bash(git checkout:*)
  - Bash(git merge:*)
  - Bash(git add:*)
---

!`hack/integrate-main.sh`.
If it fails, fix conflicts and retry. Otherwise just report success.
