import { describe, expect, it } from "vitest";
import { resolveModel } from "./providers.js";

describe("resolveModel", () => {
  it("maps all three provider families", () => {
    expect(resolveModel("anthropic", "claude-sonnet-5").modelId).toBe("claude-sonnet-5");
    expect(resolveModel("openai", "gpt-5.2").modelId).toBe("gpt-5.2");
    expect(resolveModel("openai-compatible", "llama3.1").modelId).toBe("llama3.1");
  });

  it("throws on unknown provider", () => {
    expect(() => resolveModel("nope", "x")).toThrow(/unknown provider/i);
  });
});
