import { describe, expect, it } from "vitest";
import { evaluatePolicy, type PolicyRule } from "./policy.js";

function rule(overrides: Partial<PolicyRule> = {}): PolicyRule {
  return {
    toolMatch: "*",
    effect: "allow",
    priority: 0,
    enabled: true,
    ...overrides,
  };
}

describe("evaluatePolicy", () => {
  it("matches wildcard, prefix glob, and exact tool names", () => {
    expect(evaluatePolicy([rule()], "http.fetch")).toBe("allow");
    expect(
      evaluatePolicy([rule({ toolMatch: "counter.*", effect: "require_approval" })], "counter.increment"),
    ).toBe("require_approval");
    expect(evaluatePolicy([rule({ toolMatch: "counter.*" })], "counter")).toBe("deny");
    expect(evaluatePolicy([rule({ toolMatch: "http.fetch" })], "http.fetch")).toBe("allow");
    expect(evaluatePolicy([rule({ toolMatch: "http.fetch" })], "httpXfetch")).toBe("deny");
  });

  it("lets the highest-priority matching rule win", () => {
    const rules = [
      rule({ toolMatch: "counter.*", effect: "deny", priority: 0 }),
      rule({ toolMatch: "counter.increment", effect: "allow", priority: 10 }),
    ];

    expect(evaluatePolicy(rules, "counter.increment")).toBe("allow");
  });

  it("breaks priority ties with deny before approval before allow", () => {
    const rules = [
      rule({ effect: "allow", priority: 5 }),
      rule({ effect: "require_approval", priority: 5 }),
    ];

    expect(evaluatePolicy(rules, "counter.increment")).toBe("require_approval");
    expect(evaluatePolicy([...rules, rule({ effect: "deny", priority: 5 })], "counter.increment")).toBe("deny");
  });

  it("denies by default when no rule matches", () => {
    expect(evaluatePolicy([], "counter.increment")).toBe("deny");
    expect(evaluatePolicy([rule({ toolMatch: "http.*" })], "counter.increment")).toBe("deny");
  });

  it("ignores disabled rules", () => {
    expect(evaluatePolicy([rule({ effect: "allow", enabled: false })], "counter.increment")).toBe("deny");
  });
});
