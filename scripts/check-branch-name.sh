#!/bin/sh
# Checks a branch name against the naming rules (see Making a change in MAINTAINING.md): a prefix for the
# kind of change, then lowercase words joined by hyphens, like feature/streak-counter.
# Used by the pre-push hook and by the CI workflow on every pull request.
#
#   sh scripts/check-branch-name.sh <branch name>

branch=$1

# main itself, and the branches Dependabot makes (dependabot/npm_and_yarn/...).
case $branch in
  main | dependabot/*) exit 0 ;;
esac

if printf '%s\n' "$branch" | grep -Eq '^(feature|fix|docs|chore)/[a-z0-9]+(-[a-z0-9]+)*$'; then
  exit 0
fi

cat >&2 <<EOF
The branch name "$branch" doesn't follow the naming rules.
Start it with one of these prefixes, then a short name in lowercase words joined by hyphens:

  feature/  new features and improvements            feature/streak-counter
  fix/      bug fixes                                fix/android-audio
  docs/     README and other docs                    docs/windows-build
  chore/    CI, refactoring, tooling, dependencies   chore/update-ci

To rename the branch you're on: git branch -m <new name>
If you've already opened a pull request from it, push the renamed branch and open a new pull request.
GitHub can't change the branch of an existing one.
EOF
exit 1
