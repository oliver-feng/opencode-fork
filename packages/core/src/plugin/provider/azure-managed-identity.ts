/**
 * Azure managed identity tokens for Azure OpenAI endpoints.
 *
 * Lets the fork reach a model with no credential stored anywhere: where Azure assigns the process
 * an identity, that identity is the credential. An explicitly configured API key still wins — see
 * the call site in ./azure.ts — so this is a default, not a replacement.
 *
 * Deliberately dependency-free (a raw fetch against the identity endpoint rather than
 * @azure/identity) so the compiled single-file binary does not pull in an SDK that brings its own
 * credential chain, config files and interactive browser fallbacks.
 */

/** Where a container's managed identity hands out tokens, when it has one. */
const IDENTITY_ENDPOINT = "IDENTITY_ENDPOINT"
const IDENTITY_HEADER = "IDENTITY_HEADER"

/** Set on a devbox to a token obtained by hand, where there is no identity endpoint. */
const TOKEN_OVERRIDE = "OPENCODE_AZURE_TOKEN"

/** Selects among user-assigned identities. Required when the resource carries more than one. */
const CLIENT_ID = "OPENCODE_AZURE_CLIENT_ID"

/**
 * The audience for Azure AI services. Not the resource's own hostname — a token minted for the
 * endpoint rather than this audience is rejected with a 401 that says nothing about why.
 */
const AUDIENCE = "https://cognitiveservices.azure.com"

/** The IMDS-over-HTTP contract Container Apps and App Service implement. */
const API_VERSION = "2019-08-01"

/** Renewed a minute early, so a request never carries a token that expires mid-flight. */
const EXPIRY_MARGIN_MS = 60_000

/** How long a token is assumed good for when the endpoint declines to say. */
const FALLBACK_LIFETIME_MS = 5 * 60_000

export class ManagedIdentityError extends Error {
  readonly _tag = "ManagedIdentityError"
}

type Cached = {
  value: string
  expiresAt: number
}

let cached: Cached | undefined

/** Shared so a burst of concurrent requests mints one token rather than one each. */
let inflight: Promise<string> | undefined

function fresh(entry: Cached | undefined): entry is Cached {
  return entry !== undefined && entry.expiresAt - Date.now() > EXPIRY_MARGIN_MS
}

async function mint(clientId: string | undefined): Promise<string> {
  const endpoint = process.env[IDENTITY_ENDPOINT]
  const header = process.env[IDENTITY_HEADER]

  if (!endpoint || !header) {
    throw new ManagedIdentityError(
      `No managed identity is available here (${IDENTITY_ENDPOINT} is unset), so no model token can be obtained. ` +
        `Run this where Azure assigns the process an identity, or set ${TOKEN_OVERRIDE} to a token obtained by hand.`,
    )
  }

  // Container Apps and App Service inject IDENTITY_ENDPOINT and IDENTITY_HEADER rather than
  // exposing the IMDS address a VM would use, so this is not the well-known 169.254.169.254 call.
  // The client id is required whenever the resource carries a user-assigned identity: with more
  // than one candidate the endpoint cannot choose, and it fails rather than picking.
  const url =
    `${endpoint}?resource=${encodeURIComponent(AUDIENCE)}&api-version=${API_VERSION}` +
    (clientId ? `&client_id=${encodeURIComponent(clientId)}` : "")

  const response = await fetch(url, { headers: { "X-IDENTITY-HEADER": header } })
  if (!response.ok) {
    throw new ManagedIdentityError(`Could not get a model token (${response.status}): ${await response.text()}`)
  }

  const body = (await response.json()) as { access_token?: string; expires_on?: unknown; expiresOn?: unknown }
  if (!body.access_token) {
    throw new ManagedIdentityError("The identity endpoint returned no access_token.")
  }

  // expires_on is seconds since the epoch, and arrives as a string often enough to be worth
  // coercing rather than trusting.
  const expiresOn = Number(body.expires_on ?? body.expiresOn ?? 0)
  cached = {
    value: body.access_token,
    expiresAt: expiresOn > 0 ? expiresOn * 1000 : Date.now() + FALLBACK_LIFETIME_MS,
  }

  return cached.value
}

/**
 * A bearer token for the model endpoint.
 *
 * @param clientId Overrides OPENCODE_AZURE_CLIENT_ID for a user-assigned identity.
 */
export async function token(clientId?: string): Promise<string> {
  const supplied = process.env[TOKEN_OVERRIDE]
  if (supplied) return supplied

  if (fresh(cached)) return cached.value
  if (inflight) return inflight

  inflight = mint(clientId ?? process.env[CLIENT_ID]).finally(() => {
    inflight = undefined
  })

  return inflight
}

/**
 * Whether a token could be obtained at all, without minting one.
 *
 * Checked before managed identity is offered as the default, so that a machine with no identity
 * keeps the provider's own "API key is missing" error rather than getting one about identities it
 * was never going to have.
 */
export function available() {
  if (process.env[TOKEN_OVERRIDE]) return true
  return Boolean(process.env[IDENTITY_ENDPOINT] && process.env[IDENTITY_HEADER])
}

/** Drops the cached token. Exported for tests; nothing in the running app needs it. */
export function reset() {
  cached = undefined
  inflight = undefined
}

export * as ManagedIdentity from "./azure-managed-identity.js"
