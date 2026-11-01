import { Agent } from "@opencode/core/agent"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { make } from "@opencode/core/plugin/provider/azure"
import { Provider } from "@opencode/core/provider"
import { Session } from "@opencode/core/session"
import { expect } from "bun:test"
import { Effect } from "effect"
import { withEnv } from "../fixture/env"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const environment = {
  IDENTITY_ENDPOINT: undefined,
  IDENTITY_HEADER: undefined,
  OPENCODE_AZURE_TOKEN: undefined,
  OPENCODE_AZURE_ENDPOINT: undefined,
  OPENCODE_AZURE_DEPLOYMENT: undefined,
  OPENCODE_AZURE_API_VERSION: undefined,
  AZURE_API_KEY: undefined,
  AZURE_COGNITIVE_SERVICES_API_KEY: undefined,
  AZURE_RESOURCE_NAME: undefined,
  AZURE_COGNITIVE_SERVICES_RESOURCE_NAME: undefined,
}
const endpoint = "https://test-resource.services.ai.azure.com"

const start = Effect.gen(function* () {
  const providers = yield* Provider.Service
  yield* providers.transform((editor) => {
    editor.update(Provider.ID.azure, (provider) => {
      provider.package = "@opencode/ai/providers/azure/responses"
    })
    editor.models.update(Provider.ID.azure, Model.ID.make("catalog-model"), (model) => {
      model.limit = { context: 400_000, output: 128_000 }
    })
  })
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* make({
    resource: () => "http://127.0.0.1:1/openai",
    management: "http://127.0.0.1:1",
  }).effect(host)
})

it.effect("makes a configured deployment the fresh-session default and sends managed identity auth", () =>
  withEnv(
    {
      ...environment,
      OPENCODE_AZURE_TOKEN: "managed-token",
      OPENCODE_AZURE_ENDPOINT: endpoint,
      OPENCODE_AZURE_DEPLOYMENT: "custom-deployment",
    },
    () =>
      Effect.gen(function* () {
        yield* start
        const providers = yield* Provider.Service
        const models = yield* Model.Service
        const hooks = yield* PluginHooks.Service
        expect((yield* providers.available()).some((provider) => provider.id === Provider.ID.azure)).toBe(true)
        expect((yield* providers.get(Provider.ID.azure))?.settings).toMatchObject({
          baseURL: `${endpoint}/openai/v1`,
          apiKey: false,
          useDeploymentBasedUrls: false,
        })
        const model = yield* models.default()
        expect(model?.providerID).toBe(Provider.ID.azure)
        expect(model?.id).toBe("custom-deployment")
        expect(model?.capabilities.tools).toBe(true)
        expect(model?.limit).toEqual({ context: 128_000, output: 16_384 })
        const request = yield* hooks.trigger("session", "http.request", {
          agent: Agent.ID.make("build"),
          model: Model.Ref.make({ providerID: Provider.ID.azure, id: Model.ID.make("custom-deployment") }),
          kind: "primary",
          sessionID: Session.ID.make("ses_managed_identity"),
          request: new Request(`${endpoint}/openai/v1/responses`),
        })
        expect(request.request.headers.get("authorization")).toBe("Bearer managed-token")
        expect(request.request.headers.has("api-key")).toBe(false)
      }),
  ),
)

it.effect("keeps catalog capabilities and an explicit default instead of replacing them with environment defaults", () =>
  withEnv(
    {
      ...environment,
      OPENCODE_AZURE_TOKEN: "managed-token",
      OPENCODE_AZURE_ENDPOINT: `${endpoint}/openai`,
      OPENCODE_AZURE_DEPLOYMENT: "catalog-model",
    },
    () =>
      Effect.gen(function* () {
        const providers = yield* Provider.Service
        const models = yield* Model.Service
        yield* providers.transform((editor) => {
          editor.update(Provider.ID.openai, (provider) => {
            provider.activation = "enabled"
          })
          editor.models.update(Provider.ID.openai, Model.ID.make("explicit-model"), () => {})
        })
        yield* models.transform((editor) => editor.default.set(Provider.ID.openai, Model.ID.make("explicit-model")))
        yield* start
        expect((yield* models.default())?.id).toBe("explicit-model")
        expect((yield* models.get(Provider.ID.azure, Model.ID.make("catalog-model")))?.limit).toEqual({
          context: 400_000,
          output: 128_000,
        })
      }),
  ),
)

it.effect("keeps an explicit API key ahead of ambient identity", () =>
  withEnv(
    {
      ...environment,
      OPENCODE_AZURE_TOKEN: "managed-token",
      OPENCODE_AZURE_ENDPOINT: `${endpoint}/openai/v1`,
      OPENCODE_AZURE_DEPLOYMENT: "custom-deployment",
    },
    () =>
      Effect.gen(function* () {
        yield* start
        const hooks = yield* PluginHooks.Service
        const result = yield* hooks.trigger("session", "http.request", {
          agent: Agent.ID.make("build"),
          model: Model.Ref.make({ providerID: Provider.ID.azure, id: Model.ID.make("custom-deployment") }),
          kind: "primary",
          sessionID: Session.ID.make("ses_explicit_key"),
          request: new Request(`${endpoint}/openai/v1/responses`, { headers: { "api-key": "explicit-key" } }),
        })
        expect(result.request.headers.get("api-key")).toBe("explicit-key")
        expect(result.request.headers.has("authorization")).toBe(false)
      }),
  ),
)

for (const values of [{ OPENCODE_AZURE_TOKEN: "managed-token" }, { OPENCODE_AZURE_ENDPOINT: endpoint }]) {
  it.effect("does not activate Azure without both an endpoint and credentials", () =>
    withEnv({ ...environment, ...values }, () =>
      Effect.gen(function* () {
        yield* start
        const providers = yield* Provider.Service
        expect((yield* providers.available()).some((provider) => provider.id === Provider.ID.azure)).toBe(false)
      }),
    ),
  )
}
