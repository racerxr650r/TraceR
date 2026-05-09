---
description: "Create a GitHub Release with the version from VERSION and auto-generated release notes"
mode: "agent"
tools: [execute, read, search, editFiles]
---
You create GitHub Releases for any repository that uses TraceR
(`doc/Project.xml`) as its specification source of truth. This prompt is
generic — it works regardless of the product domain, language, or framework.

Perform the following steps in order. Stop and report if any step fails.

## 0. Discover project layout

- Locate the `VERSION` file (workspace root or search for it).
- If `VERSION` does not exist, check `package.json`, `pyproject.toml`,
  `setup.cfg`, or `Cargo.toml` for a version field. If no version source
  is found, stop and ask the user for the version number.
- Determine the default branch (`develop`, `main`, or remote default).

## 1. Read version and validate

- Read the version string from the `VERSION` file (trim whitespace).
- Check that the current branch is the default branch (or that the release
  PR has been merged): `git log --oneline -1` should show the merge commit.
- Check that a tag for this version does not already exist:
  `git tag -l "v<version>"`. If it exists, stop and inform the user.

## 2. Generate release notes

- Identify the previous release tag:
  `git tag --sort=-v:refname | grep -E '^v?[0-9]+\.[0-9]+' | head -1`
- Collect commits since the previous release:
  `git log --oneline <previous-tag>..HEAD`
- Organise the commits into categories based on conventional commit prefixes:
  - **Features** (`feat`)
  - **Bug Fixes** (`fix`)
  - **Documentation** (`docs`)
  - **Refactoring** (`refactor`)
  - **Tests** (`test`)
  - **CI/CD** (`ci`)
  - **Other** (everything else)
- Format as Markdown release notes:
  ```
  ## What's Changed

  ### Features
  - <summary> (<short-sha>)

  ### Bug Fixes
  - <summary> (<short-sha>)

  ### Documentation
  - <summary> (<short-sha>)

  ...

  **Full Changelog**: <previous-tag>...v<version>
  ```
- If there is no previous tag (first release), include all commits from
  the beginning of the repository.
- Present the release notes to the user for approval before proceeding.

## 3. Create the git tag

- Create an annotated tag: `git tag -a "v<version>" -m "Release <version>"`
- Push the tag: `git push origin "v<version>"`

## 4. Create the GitHub Release

- Use the GitHub CLI:
  ```
  gh release create "v<version>" \
      --title "v<version>" \
      --notes "<release-notes>" \
      --target <default-branch>
  ```
- If there are build artefacts to attach (e.g. `.vsix`, binaries, tarballs),
  ask the user whether to include them. If yes, add them with:
  ```
  gh release upload "v<version>" <file1> <file2> ...
  ```
- If `gh` CLI is not available, stop after pushing the tag and provide
  instructions to create the release manually on GitHub with the generated
  release notes.

## 5. Summary

Report to the user:
- The version released
- The tag created
- A link to the GitHub Release page
- Number of commits included
- Any artefacts attached

## 6. Bump VERSION for next development cycle

Only perform this step if all previous steps (tag push and GitHub Release
creation) succeeded. If any step failed, skip this entirely.

- Read the current version from the `VERSION` file in the project root.
- Increment the **minor** (second) version number and reset the patch
  (third) number to zero. For example `v0.3.0` becomes `v0.4.0`.
- Write the new version string back to the `VERSION` file.
- Commit the change: `git commit -am "chore: bump VERSION to <new-version>"`
- Push the commit to the default branch.
- Inform the user that the working version is now `<new-version>`.

## Constraints

- Do NOT create a release if the VERSION tag already exists.
- Do NOT modify source code or spec documents (other than the VERSION bump
  in step 6) — this prompt only releases.
- Do NOT force-push tags.
- Do NOT assume fixed paths — discover them from the workspace structure.
- Present release notes to the user for approval before creating the release.
- If `gh` CLI is not available or not authenticated, perform all local steps
  (tag creation and push) and provide manual instructions for the GitHub
  Release.
- If the working tree is dirty, stop and ask the user to commit or stash
  first.
