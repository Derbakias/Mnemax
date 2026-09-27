# Maintaining Mnemax

How changes get into `main`, how releases are made, and how the GitHub repository is set up. This is for
the maintainer. For building and running the app, see the [README](README.md).

## The flow at a glance

1. Every change is made on its own branch and merged into `main` through a pull request. There is no
   `dev` branch: `main` is always working, because CI has to pass before anything merges.
2. Pull requests are **squash-merged**, so each one becomes a single commit on `main`, named after the
   pull request's title.
3. Each pull request gets **one label** (`enhancement`, `bug`, `maintenance`…). The label decides where it
   appears in the release notes.
4. When enough has been merged for a release, `pnpm version` sets the new version and creates a tag.
   Pushing the tag builds the release files and creates a **draft** release with the notes filled in.
5. You check the draft and publish it.

## Making a change

```bash
git switch main && git pull           # start from the latest main
git switch -c fix/android-audio       # a new branch, named after the change
# work and commit as often as you like
git push -u origin fix/android-audio
gh pr create --fill --label bug       # or open the pull request on GitHub
```

Name the branch after the change, with a prefix for the kind of change:

- `feature/` for new features and improvements, e.g. `feature/streak-counter`
- `fix/` for bug fixes, e.g. `fix/android-audio`
- `docs/` for the README and other docs, e.g. `docs/windows-build`
- `chore/` for CI, refactoring, tooling and dependency updates, e.g. `chore/update-ci`

They line up with the labels: `feature/` is usually `enhancement`, `fix/` is `bug`, `docs/` is
`documentation`, and `chore/` is `maintenance` or `dependencies`.

The part after the prefix is lowercase words joined by hyphens. These rules are enforced: the pre-push
hook refuses to push a branch named any other way, and so does the **Branch name** check on every pull
request, which also covers contributors' branches in their forks. Only `main` and Dependabot's own
`dependabot/...` branches are exempt. The rules live in `scripts/check-branch-name.sh`; change them
there if you ever want another prefix.

A branch named wrong can be renamed with `git branch -m <new name>` before pushing. Once a pull request
is open, GitHub can't change its branch, so the renamed branch needs a new pull request.

The branch is deleted after merging, so the name only matters while the pull request is open.

The commits on the branch can be messy ("wip", "fix typo"). Only the pull request's title ends up on
`main`, so that's the part to get right: describe the change for users, like "Fix letter audio cutting
off on Android", not "fixes" or "update play.tsx". `gh pr create --fill` uses the first commit's message
as the title. Change it with `gh pr edit --title "..."` or on GitHub if it doesn't read well.

The git hooks run the typecheck and tests before each commit, and `cargo test` before a push that
changes Rust code (see Contributing in the README). On GitHub, the **CI** workflow runs the same checks
on the pull request. Once they pass, merge it:

```bash
gh pr merge --squash --delete-branch  # or the "Squash and merge" button on GitHub
git switch main && git pull
```

Squash is the only merge method the repository allows, and merged branches are deleted on GitHub
automatically.

### Which label

Give each pull request one of these. It's the section it appears under in the release notes (set in
`.github/release.yml`):

| Label                | Release notes section | For                                                            |
| -------------------- | --------------------- | -------------------------------------------------------------- |
| `breaking`           | Breaking changes      | Changes users need to know about before updating, e.g. a new data format that older exports don't match |
| `enhancement`        | New features          | New features and improvements                                  |
| `bug`                | Fixes                 | Bug fixes                                                      |
| `accessibility`      | Accessibility         | Screen readers, contrast, keyboard use, text size…             |
| `documentation`      | Documentation         | README and other docs                                          |
| `maintenance`        | Maintenance           | CI, refactoring, tooling: nothing users will notice            |
| `dependencies`       | Dependencies          | Library updates (Dependabot adds this itself)                  |
| `ignore-for-release` | *(left out)*          | Changes not worth mentioning at all                            |

A pull request without any of these goes under "Other changes". If it has two, the first section in the
table wins. Forgetting a label isn't a problem: add it any time before publishing the release.

### Pushing straight to main

The admin can push to `main` directly, skipping the pull request. Keep that for things that don't
need a line in the release notes and can't break anything, like a README typo. A direct push isn't
checked by CI first, and it never appears in the release notes, because they only list pull requests.

## Pull requests from contributors

- The first time someone contributes, GitHub doesn't run the workflows on their pull request until the admin 
  allows that. Click **Approve and run workflows** on the pull request, after checking the changes don't
  touch `.github/workflows/` or `scripts/` in a suspicious way.
- The checks run with the pull request's own copy of the workflows and scripts, so a pull request that
  changes them can change what the checks do, for example to let a badly named branch pass. Look closely
  at any change to `.github/` or `scripts/check-branch-name.sh`.
- Before merging, fix up the title if needed (see above) and add a label.
- Squash-merging keeps the contributor as the commit's author, and the release notes credit them
  ("by @name").

## Dependabot pull requests

Dependabot opens grouped pull requests every month (npm, Rust and GitHub Actions and the Android project), 
already labelled `dependencies`. If CI passes, a patch or minor update can usually just
be merged. For bigger updates, run the app (`pnpm desktop`, and `pnpm android` for Android changes)
before merging.

Tauri's npm packages and Rust crates come in two separate pull requests (a `tauri` group in each).
Merge them together: Tauri refuses to build when the versions of the npm packages and the crates don't
match.

Security updates arrive as their own pull requests. Merge them as soon as possible.

## Issues

New bug reports come in with the `triage` label. Once I read one, remove `triage` and either reply,
label it, or close it. `good first issue` and `help wanted` mark issues other people could pick up.

## Releasing

### Choosing the version

The version number lives in one place: the `version` field in `package.json`. Tauri reads it from there
(`tauri.conf.json` points to `../package.json`) and uses it for the Linux packages and the Android app
version. It's also shown at the bottom of the **Settings** screen in the app.

The version only changes when a release is made, never in a pull request. Several merged pull requests
usually go out together in one release. Pick the next version by what's in the release:

| Command             | When                                           | Example       |
| ------------------- | ---------------------------------------------- | ------------- |
| `pnpm version patch` | Only fixes                                     | 0.1.0 → 0.1.1 |
| `pnpm version minor` | New features                                   | 0.1.0 → 0.2.0 |
| `pnpm version major` | Breaking changes (anything labelled `breaking`) | 0.1.0 → 1.0.0 |

While the version starts with 0, breaking changes can go in a minor release instead. Move to 1.0.0 when
the app is stable.

### Making a release

```bash
git switch main && git pull
pnpm version minor --message "Release v%s"   # sets the version, commits it, and tags it (v0.2.0)
git push --follow-tags                # pushes the commit and the tag
gh run watch                          # optional: follow the build in the terminal
```

`pnpm version` needs a clean working tree. The pre-commit hook runs the tests on the version commit too.

The tag starts the **Release** workflow (`.github/workflows/release.yml`). It checks that the tag matches
`package.json`, builds the Linux files and the signed Android APKs, names them as in
[Release file names](README.md#release-file-names), and attaches them to a draft release. This takes
a while, mostly for the Android builds. Then, on GitHub under **Releases**, open the draft and:

1. Check that all five files are attached: the AppImage, `.deb`, `.rpm`, universal APK and arm64 APK.
2. Read the notes. If you added labels after the draft was made, click **Generate release notes** again
   to redo the sections. Add a sentence or two at the top about the highlights.
3. Click **Publish release**.

To try a release build without releasing anything, open **Actions → Release → Run workflow** (or run
`gh workflow run release.yml`). The files are then kept as workflow artifacts on the run's page for 90
days.

### If the release build fails

If it looks like a one-off (a download timed out, for example), re-run the failed jobs with
`gh run rerun --failed` or the button on the run's page. The draft is created once both builds pass.

If something needs fixing in the code, and the release hasn't been published yet:

```bash
# Remove the tag, and the draft release if one was created
gh release delete v0.2.0 --yes
git push --delete origin v0.2.0
git tag -d v0.2.0

# Fix it through a pull request as usual, then tag the new main
git switch main && git pull
git tag v0.2.0
git push origin v0.2.0
```

`package.json` already says 0.2.0 from the first attempt, so there's nothing to change there.

Once a release is published, don't move or reuse its tag. People may already have downloaded it. Make a
new patch release with the fix instead.

## The Android signing key

Release APKs must be signed with the same key every time. Android only installs an update over an
existing install if it's signed with the same key as before. The key is
`~/android-keys/mnemax-release.jks`, and its alias and password are in
`src-tauri/gen/android/keystore.properties` (see Signing in the README). Keep a backup of both
somewhere other than this computer. 

> **If the key is lost, users would have to uninstall the app, losing
their data unless they exported, just to install the next version.**

The Release workflow uses the same key, stored as three repository secrets (**Settings → Secrets and
variables → Actions**):

- `ANDROID_KEYSTORE_BASE64`: the key file, as `base64 -w0 ~/android-keys/mnemax-release.jks`
- `ANDROID_KEY_ALIAS`: `mnemax`
- `ANDROID_KEY_PASSWORD`: the password from `keystore.properties`

If the key or its password ever changes, set the secrets again:

```bash
base64 -w0 ~/android-keys/mnemax-release.jks | gh secret set ANDROID_KEYSTORE_BASE64
gh secret set ANDROID_KEY_ALIAS --body mnemax
grep '^password=' src-tauri/gen/android/keystore.properties | cut -d= -f2- | tr -d '\n' | gh secret set ANDROID_KEY_PASSWORD
```

## How the repository is set up

For reference, and in case something needs to be set up again.

**Files in `.github/`**

| File                            | What it does                                                           |
| ------------------------------- | ---------------------------------------------------------------------- |
| `workflows/ci.yml`              | Branch name check, typecheck, tests and Rust tests on every pull request and push to main |
| `workflows/release.yml`         | Builds the release files and drafts the release when a `v*` tag is pushed |
| `release.yml`                   | The release notes sections, by label                                   |
| `dependabot.yml`                | Which dependencies Dependabot updates, and how often                   |
| `ISSUE_TEMPLATE/`               | The bug report and feature request forms                               |

**Settings on GitHub**

- **Rulesets** (Settings → Rules → Rulesets):
  - *Protect main*: `main` can't be deleted or force-pushed. Changes go through a pull request, the
    three CI checks (*Branch name*, *Typecheck and tests*, *Rust tests*) must pass, and pull requests are squash-merged. No
    approving review is needed, since you can't approve your own pull requests. Repository admins can
    bypass these rules.
  - *Protect tags*: only repository admins can create, move or delete tags.
- **General**: only squash merging is allowed, and merged branches are deleted automatically. The squash
  commit is titled with the pull request's title and has an empty body, so the branch's own commit
  messages and the pull request's description don't end up on `main`.
- **Code security**: Dependabot alerts and security updates, secret scanning, and push protection
  (which blocks a push that contains a password or key) are on.
- **Secrets**: the three Android signing secrets above.
- **Labels**: the ones in [Which label](#which-label), plus `triage`, `good first issue`, `help wanted`,
  `question`, `duplicate`, `invalid` and `wontfix` for issues.
