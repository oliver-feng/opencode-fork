import { afterEach, beforeEach, expect, test } from "bun:test"
import { ManagedIdentity } from "@opencode/core/plugin/provider/azure-managed-identity"

const ENV_KEYS = ["IDENTITY_ENDPOINT", "IDENTITY_HEADER", "OPENCODE_AZURE_TOKEN", "OPENCODE_AZURE_CLIENT_ID"] as const

const saved = new Map<string, string | undefined>()
const realFetch = globalThis.fetch

type Call = { url: URL; identityHeader: string | null }

/** Records every identity-endpoint call so the tests can assert on caching and headers. */
function stubIdentity(response: (url: URL) => Response) {
  const calls: Call[] = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.pathname !== "/identity") return realFetch(input, init)
    calls.push({ url, identityHeader: new Headers(init?.headers).get("x-identity-header") })
    return response(url)
  }) as typeof globalThis.fetch
  return calls
}

function tokenResponse(token: string, expiresInSeconds = 3600) {
  return new Response(
    JSON.stringify({
      access_token: token,
      // Azure sends this as a string often enough to be worth covering.
      expires_on: String(Math.floor(Date.now() / 1000) + expiresInSeconds),
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  )
}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved.set(key, process.env[key])
    delete process.env[key]
  }
  ManagedIdentity.reset()
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  globalThis.fetch = realFetch
  ManagedIdentity.reset()
})

test("available() is false without an identity endpoint", () => {
  expect(ManagedIdentity.available()).toBe(false)

  process.env.IDENTITY_ENDPOINT = "http://localhost/identity"
  expect(ManagedIdentity.available()).toBe(false)

  process.env.IDENTITY_HEADER = "secret"
  expect(ManagedIdentity.available()).toBe(true)
})

test("the hand-obtained token override wins and needs no endpoint", async () => {
  process.env.OPENCODE_AZURE_TOKEN = "devbox-token"
  expect(ManagedIdentity.available()).toBe(true)
  expect(await ManagedIdentity.token()).toBe("devbox-token")
})

test("mints a token against the identity endpoint with the right audience and header", async () => {
  process.env.IDENTITY_ENDPOINT = "http://localhost/identity"
  process.env.IDENTITY_HEADER = "secret"

  const calls = stubIdentity(() => tokenResponse("minted"))

  expect(await ManagedIdentity.token()).toBe("minted")
  expect(calls).toHaveLength(1)
  expect(calls[0].identityHeader).toBe("secret")
  expect(calls[0].url.searchParams.get("resource")).toBe("https://cognitiveservices.azure.com")
  expect(calls[0].url.searchParams.get("api-version")).toBe("2019-08-01")
  expect(calls[0].url.searchParams.get("client_id")).toBeNull()
})

test("passes the client id for a user-assigned identity", async () => {
  process.env.IDENTITY_ENDPOINT = "http://localhost/identity"
  process.env.IDENTITY_HEADER = "secret"
  process.env.OPENCODE_AZURE_CLIENT_ID = "11111111-2222-3333-4444-555555555555"

  const calls = stubIdentity(() => tokenResponse("minted"))

  await ManagedIdentity.token()
  expect(calls[0].url.searchParams.get("client_id")).toBe("11111111-2222-3333-4444-555555555555")
})

test("caches a live token and re-mints once it is inside the expiry margin", async () => {
  process.env.IDENTITY_ENDPOINT = "http://localhost/identity"
  process.env.IDENTITY_HEADER = "secret"

  let issued = 0
  const calls = stubIdentity(() => tokenResponse(`token-${++issued}`))

  expect(await ManagedIdentity.token()).toBe("token-1")
  expect(await ManagedIdentity.token()).toBe("token-1")
  expect(calls).toHaveLength(1)

  // 30s of life left is inside the 60s margin, so the next call must not reuse it.
  ManagedIdentity.reset()
  issued = 0
  stubIdentity(() => tokenResponse(`short-${++issued}`, 30))
  expect(await ManagedIdentity.token()).toBe("short-1")
  expect(await ManagedIdentity.token()).toBe("short-2")
})

test("concurrent callers share one in-flight mint", async () => {
  process.env.IDENTITY_ENDPOINT = "http://localhost/identity"
  process.env.IDENTITY_HEADER = "secret"

  let issued = 0
  const calls = stubIdentity(() => tokenResponse(`token-${++issued}`))

  const results = await Promise.all([ManagedIdentity.token(), ManagedIdentity.token(), ManagedIdentity.token()])
  expect(results).toEqual(["token-1", "token-1", "token-1"])
  expect(calls).toHaveLength(1)
})

test("reports a failing identity endpoint with its status and body", async () => {
  process.env.IDENTITY_ENDPOINT = "http://localhost/identity"
  process.env.IDENTITY_HEADER = "secret"

  stubIdentity(() => new Response("no identity assigned", { status: 400 }))

  await expect(ManagedIdentity.token()).rejects.toThrow(/400.*no identity assigned/s)
})

test("explains itself when there is no identity at all", async () => {
  await expect(ManagedIdentity.token()).rejects.toThrow(/IDENTITY_ENDPOINT is unset/)
})
