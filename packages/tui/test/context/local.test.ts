import { expect, test } from "bun:test"
import { parseModel, pickFallbackProviderModel, recentModels } from "../../src/context/local"

const providers: { id: string; models: Record<string, { id: string }> }[] = [
  { id: "amazon-bedrock", models: { "big-pickle": { id: "big-pickle" } } },
  { id: "azure", models: { "gpt-5.6-sol": { id: "gpt-5.6-sol" } } },
]
const providerDefault: Record<string, string> = { "amazon-bedrock": "big-pickle", azure: "gpt-5.6-sol" }

test("parses model IDs containing slashes", () => {
  expect(parseModel("provider/family/model")).toEqual({
    providerID: "provider",
    modelID: "family/model",
  })
})

test("moves a model to the front, deduplicates, and limits recents", () => {
  const recent = Array.from({ length: 12 }, (_, index) => ({
    providerID: "provider",
    modelID: `model-${index}`,
  }))

  expect(recentModels({ providerID: "provider", modelID: "model-5" }, recent)).toEqual([
    { providerID: "provider", modelID: "model-5" },
    ...recent.slice(0, 5),
    ...recent.slice(6, 10),
  ])
})

test("prefers the configured Azure deployment over the first provider", () => {
  // amazon-bedrock sorts first, so without this the session would open on big-pickle.
  expect(pickFallbackProviderModel(providers, providerDefault, "gpt-5.6-sol")).toEqual({
    providerID: "azure",
    modelID: "gpt-5.6-sol",
  })
})

test("falls back to Azure's provider default when the deployment is not a known model", () => {
  expect(pickFallbackProviderModel(providers, providerDefault, "some-unlisted-deployment")).toEqual({
    providerID: "azure",
    modelID: "gpt-5.6-sol",
  })
})

test("keeps the first provider when no Azure deployment is configured", () => {
  expect(pickFallbackProviderModel(providers, providerDefault, undefined)).toEqual({
    providerID: "amazon-bedrock",
    modelID: "big-pickle",
  })
})

test("keeps the first provider when azure is absent", () => {
  const bedrockOnly = [providers[0]]
  expect(pickFallbackProviderModel(bedrockOnly, providerDefault, "gpt-5.6-sol")).toEqual({
    providerID: "amazon-bedrock",
    modelID: "big-pickle",
  })
})
