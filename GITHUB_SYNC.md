# Keeping the public GitHub copy current

The public repository is [`E100978l/MediSched-export`](https://github.com/E100978l/MediSched-export), branch `main`.

## Prepare a snapshot

After intentional code changes, run this from the Replit workspace:

```sh
npm run github:export
```

The command refreshes `.github-export/repo/` and `.github-export/manifest.json`. It also creates `MediSched.zip` and a matching `MediSched-export.zip` compatibility copy in the workspace. `MediSched.zip` inside `.github-export/repo/` is the archive that belongs in the public repository.

The manifest lists every repository path with its SHA-256 hash and size. It is a local synchronization aid; do not upload the manifest itself.

## Update GitHub as one change

Use the connected GitHub integration to:

1. Read the current `main` ref and its recursive tree.
2. Create Git blobs for all files in `.github-export/repo/` and a replacement tree based on the current tree. The complete file list comes from `.github-export/manifest.json`.
3. Remove stale generated build files and generated iOS bundles from the replacement tree. Keep repository content outside the exported source set only when it is intentional documentation or repository configuration.
4. Create one commit for the replacement tree and advance `main`.
5. Read the resulting tree and confirm each manifest path exists with the matching file size; verify `MediSched.zip` is part of that same commit.

Prefer the Git Database blobs/tree/commit API to updating files one-by-one through the Contents API. If a Contents write is rejected by the proxy, use the Git Database API for the whole snapshot rather than leaving the archive and source files at different revisions.

## Export exclusions

The export script uses an explicit list of project files and source directories. It omits dependency folders, build output, caches, Replit Agent metadata, generated iOS bundles, local environment files, and common credential/key/database file types. If the intended public source set changes, update `scripts/export-github.mjs` and this document together.
