import { describe, expect, it } from "vitest";
import { httpFetchTool } from "./builtins.js";

describe("httpFetchTool", () => {
  it("rejects non-HTTPS URLs", () => {
    expect(httpFetchTool.inputSchema.safeParse({ url: "http://example.com" }).success).toBe(
      false,
    );
  });

  it("rejects missing URLs", () => {
    expect(httpFetchTool.inputSchema.safeParse({}).success).toBe(false);
  });

  it.skipIf(process.env.OFFLINE === "1")(
    process.env.OFFLINE === "1"
      ? "fetches an HTTPS URL (skipped: OFFLINE=1)"
      : "fetches an HTTPS URL and limits the response body to 4000 characters",
    async () => {
      const parsed = httpFetchTool.inputSchema.safeParse({ url: "https://example.com" });
      expect(parsed.success).toBe(true);
      if (!parsed.success) throw new Error("expected valid HTTPS arguments");

      const result = (await httpFetchTool.execute(parsed.data)) as {
        status: number;
        body: string;
      };

      expect(result.status).toBe(200);
      expect(result.body.length).toBeLessThanOrEqual(4000);
      expect(result.body).toContain("Example Domain");
    },
  );
});
