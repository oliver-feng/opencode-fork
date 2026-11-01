#!/usr/bin/env bun

// Builds the opencode binary for one or more platforms and packs each one as a
// runnable .NET global tool NuGet package.
//
// The Bun build produces a self-contained executable per platform, so every
// package targets exactly one runtime identifier and needs no runtime on the
// host. OPENCODE_VERSION is set explicitly: left unset, Script.version derives
// a version from the branch name and, on the latest channel, reaches out to
// registry.npmjs.org.

import { $ } from "bun"
import fs from "fs/promises"
import path from "path"

const RIDS: Record<string, string> = {
  "win-x64": "windows-x64",
  "linux-x64": "linux-x64",
}

// The published version of this fork. Bump the prerelease label here for each
// build that goes to the feed -- beta.1, beta.2, and so on.
//
// Deliberately not read from packages/cli/package.json: that number is
// upstream opencode's, so merging upstream would silently change what this
// package claims to be, and two builds of the same upstream version could not
// be told apart. The prerelease label needs its SemVer hyphen (1.18.4-beta.1,
// not 1.18.4.beta.1) -- NuGet requires a numeric fourth component, so the
// dotted form is rejected outright.
const PACKAGE_VERSION = "1.18.4-beta.6"

const root = path.resolve(import.meta.dir, "..")
const codingAgentDir = path.join(root, "packages", "cli")

function printUsage() {
  console.log(`Usage: bun run script/package-nuget.ts [options]

Builds the opencode binary and packs it as a .NET global tool package, one
package per runtime identifier.

Options:
  --rid <list>    Comma separated runtime identifiers (default win-x64).
                  Supported: ${Object.keys(RIDS).join(", ")}
  --version <v>   Version for the binary and the package (default
                  ${PACKAGE_VERSION}, set by PACKAGE_VERSION in this script)
  --skip-build    Reuse the existing packages/cli/dist/nuget output
  --skip-deps     Skip the build's cross-platform dependency install. Safe once
                  it has run before; it rewrites bun.lock with resolved tarball
                  URLs, so avoid committing that churn.
  --skip-pack     Stage the payload but do not run dotnet pack
  --out <dir>     Output directory for the .nupkg (default dist/nuget, which is
                  gitignored; note artifacts/ in this repo is tracked)
  --help          Show this help
`)
}

const args = process.argv.slice(2)
const options = {
  out: undefined as string | undefined,
  rids: ["win-x64"],
  skipBuild: false,
  skipDeps: false,
  skipPack: false,
  version: undefined as string | undefined,
}

for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === "--help") {
    printUsage()
    process.exit(0)
  } else if (arg === "--skip-build") {
    options.skipBuild = true
  } else if (arg === "--skip-deps") {
    options.skipDeps = true
  } else if (arg === "--skip-pack") {
    options.skipPack = true
  } else if (arg === "--rid") {
    const value = args[++i]
    if (!value) throw new Error("--rid requires a value")
    options.rids = value.split(",").map((x) => x.trim())
  } else if (arg === "--version") {
    const value = args[++i]
    if (!value) throw new Error("--version requires a value")
    options.version = value
  } else if (arg === "--out") {
    const value = args[++i]
    if (!value) throw new Error("--out requires a directory")
    options.out = value
  } else {
    throw new Error(`Unknown option: ${arg}`)
  }
}

for (const rid of options.rids) {
  if (!RIDS[rid]) throw new Error(`Unsupported runtime identifier: ${rid}. Supported: ${Object.keys(RIDS).join(", ")}`)
}

const version = options.version ?? PACKAGE_VERSION
const artifactDir = path.resolve(options.out ?? path.join(root, "dist", "nuget"))
const projectPath = path.join(root, "nuget", "Opencode.Contained.csproj")

await fs.mkdir(artifactDir, { recursive: true })

for (const rid of options.rids) {
  const target = RIDS[rid]
  const buildDir = path.join(codingAgentDir, "dist", "nuget", target)
  if (!options.skipBuild) {
    console.log(`Building opencode ${version} for ${target}`)
    const buildArgs = [`--outdir=${buildDir}`, ...(options.skipDeps ? ["--skip-install"] : [])]
    await $`bun run --cwd ${codingAgentDir} build ${buildArgs}`.env({
      ...process.env,
      OPENCODE_VERSION: version,
      OPENCODE_TARGET: target,
    })
  }
  const binDir = path.join(buildDir, `cli-${target}`, "bin")
  if (!(await fs.exists(binDir))) {
    throw new Error(`Missing build output for ${rid}: ${binDir}`)
  }

  const payloadDir = path.join(root, "nuget", "payload", rid)
  await fs.rm(payloadDir, { force: true, recursive: true })
  await fs.mkdir(payloadDir, { recursive: true })
  await fs.cp(binDir, payloadDir, { recursive: true })
  console.log(`Staged ${rid} payload from ${binDir}`)

  if (options.skipPack) continue

  await $`dotnet pack ${projectPath} --configuration Release -p:PayloadRid=${rid} -p:Version=${version} --output ${artifactDir}`
  console.log(`Packed Opencode.Contained.${rid}.${version}.nupkg`)
}

if (!options.skipPack) {
  console.log(`\nPackages in ${artifactDir}`)
  console.log("\nInstall one with:")
  console.log(
    `  dotnet tool install -g Opencode.Contained.${options.rids[0]} --version ${version} --add-source ${artifactDir}`,
  )
  console.log("  opencode-fork --version")
}
