# Opencode.Contained

A runnable NuGet packaging of this opencode fork, built as a .NET global tool so it can be
published to an Azure Artifacts feed and installed anywhere `dotnet` is available.

The package carries a **self-contained binary compiled by Bun** — the Bun runtime and the web
UI are embedded in it. Nothing else is required on the host: no Node.js, no Bun.

## Packages

The compiled binary is platform-specific, so there is one package per runtime identifier:

| Package | Platform |
| --- | --- |
| `Opencode.Contained.win-x64` | Windows x64 |
| `Opencode.Contained.linux-x64` | Linux x64 (glibc) |

Both expose the same command: **`opencode-fork`** — named so it can be installed alongside an
upstream `opencode` without colliding.

## Requirements

- .NET 8 runtime or newer (the launcher rolls forward to the newest installed major)

## Install

```sh
dotnet tool install -g Opencode.Contained.win-x64 --version 1.18.4-beta.1 --add-source <feed-or-directory>
opencode-fork --version
```

The published versions are prereleases, so `dotnet tool install` will not pick one up without
an explicit `--version` (or `--prerelease`).

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
bun run script/package-nuget.ts --rid win-x64
bun run script/package-nuget.ts --rid linux-x64
```

Packages land in `dist/nuget`. Useful flags: `--skip-build`, `--skip-deps`, `--skip-pack`,
`--out <dir>`.

### Versioning

The version lives in one place: `PACKAGE_VERSION` in `script/package-nuget.ts`, currently
`1.18.4-beta.1`. Bump the prerelease label there for each build that goes to the feed —
`1.18.4-beta.2`, and so on. `--version <v>` still overrides it for a one-off build.

It is deliberately not taken from `packages/opencode/package.json`. That number is upstream
opencode's, so merging upstream would silently change what this package claims to be, and two
builds of the same upstream version could not be told apart.

The label needs its SemVer hyphen — `1.18.4-beta.1`, not `1.18.4.beta.1`. NuGet requires a
numeric fourth component, so the dotted form is rejected. Prereleases also sort *below* the
plain release, so `1.18.4-beta.2` is older than `1.18.4` as far as NuGet is concerned.

Whatever is used becomes `OPENCODE_VERSION` for the Bun build, so `opencode-fork --version`
agrees with the package version. That also bypasses `Script.version`
(`packages/script/src/index.ts`), which would otherwise derive a version from the git branch
and, on the `latest` channel, reach out to registry.npmjs.org.

### A caveat about `bun.lock`

The build runs `bun install --os="*" --cpu="*"` to fetch cross-platform native dependencies,
which rewrites `bun.lock`. In an environment with a private npm mirror, bun records the
mirror's tarball URLs in the lockfile — do not commit that churn. Pass `--skip-deps` once those
dependencies are present, and check `git diff bun.lock` before committing.
