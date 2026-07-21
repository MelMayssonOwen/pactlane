import { streamText, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { StreamFn } from "./executeRun.js";

export type ResolvedModel = Exclude<LanguageModel, string>;

export function resolveModel(provider: string, model: string): ResolvedModel {
  switch (provider) {
    case "anthropic":
      return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" })(model);
    case "openai":
      return createOpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "" })(model);
    case "openai-compatible":
      return createOpenAICompatible({
        name: "local",
        baseURL: process.env.OPENAI_COMPATIBLE_BASE_URL ?? "http://localhost:11434/v1",
        apiKey: process.env.OPENAI_COMPATIBLE_API_KEY ?? "local",
      })(model);
    default:
      throw new Error(`unknown provider: ${provider}`);
  }
}

export const aiStream: StreamFn = async function* ({ system, prompt, provider, model }) {
  const result = streamText({ model: resolveModel(provider, model), system, prompt });
  // fullStream instead of textStream: streamText swallows provider errors by
  // design, and a swallowed error must fail the run, not end it "done".
  for await (const part of result.fullStream) {
    if (part.type === "text-delta") {
      yield part.text;
    } else if (part.type === "error") {
      const err = (part as { error?: unknown }).error;
      throw err instanceof Error ? err : new Error(String(err ?? "provider stream error"));
    }
  }
};
