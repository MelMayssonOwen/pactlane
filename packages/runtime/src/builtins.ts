import { z } from "zod";
import type { ToolDef } from "./tools.js";

const httpFetchInputSchema = z.object({
  url: z
    .string()
    .url()
    .refine((value) => new URL(value).protocol === "https:", {
      message: "url must use HTTPS",
    }),
  method: z.enum(["GET"]).optional(),
});

export const httpFetchTool: ToolDef = {
  name: "http.fetch",
  description: "Fetch an HTTPS URL with GET and return its status and response body.",
  inputSchema: httpFetchInputSchema,
  async execute(args) {
    const input = httpFetchInputSchema.parse(args);
    const response = await fetch(input.url, { method: input.method ?? "GET" });
    const body = (await response.text()).slice(0, 4000);
    return { status: response.status, body };
  },
};

export const builtinTools: ToolDef[] = [httpFetchTool];
