# Opencode.Fork

A runnable NuGet packaging of this opencode fork, built as a .NET global tool so it can be
published to an Azure Artifacts feed and installed anywhere `dotnet` is available.

The package carries a **self-contained binary compiled by Bun** — the Bun runtime and the web
UI are embedded in it. Nothing else is required on the host: no Node.js, no Bun.

## Packages

The compiled binary is platform-specific, so there is one package per runtime identifier:

| Package | Platform |
| --- | --- |
| `Opencode.Fork.win-x64` | Windows x64 |
| `Opencode.Fork.linux-x64` | Linux x64 (glibc) |

Both expose the same command: **`opencode-fork`** — named so it can be installed alongside an
upstream `opencode` without colliding.

## Requirements

- .NET 8 runtime or newer (the launcher rolls forward to the newest installed major)

## Install

```sh
dotnet tool install -g Opencode.Fork.win-x64 --add-source <feed-or-directory>
opencode-fork --version
```

## Use

```sh
opencode-fork --help
opencode-fork                 # interactive TUI
```

Arguments are forwarded verbatim to the binary and its exit code is propagated. On Linux the
launcher restores the executable bit on first run, because NuGet packages do not carry unix
file modes.

## Build the packages

Requires `bun` (the version pinned in the root `package.json`) and the .NET SDK.

```sh
bun install
bun run script/package-nuget.ts --rid win-x64 --version 1.18.4
bun run script/package-nuget.ts --rid linux-x64 --version 1.18.4
```

Packages land in `dist/nuget`. Useful flags: `--skip-build`, `--skip-deps`, `--skip-pack`,
`--out <dir>`.

### Why `--version` matters

Left unset, `Script.version` (`packages/script/src/index.ts`) derives the version from the
current git branch: on any branch other than `latest` it produces `0.0.0-<branch>-<timestamp>`,
and on `latest` it fetches the newest release from registry.npmjs.org. Passing `--version` sets
`OPENCODE_VERSION`, which makes the build deterministic, keeps `opencode-fork --version` in
agreement with the package version, and avoids the network call.

Note that NuGet treats `0.0.0-...` as a prerelease, so a package built without `--version`
needs `--prerelease` to install.

### A caveat about `bun.lock`

The build runs `bun install --os="*" --cpu="*"` to fetch cross-platform native dependencies,
which rewrites `bun.lock`. In an environment with a private npm mirror, bun records the
mirror's tarball URLs in the lockfile — do not commit that churn. Pass `--skip-deps` once those
dependencies are present, and check `git diff bun.lock` before committing.
