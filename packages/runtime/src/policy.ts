export type PolicyRule = {
  toolMatch: string;
  effect: "allow" | "deny" | "require_approval";
  priority: number;
  enabled: boolean;
};

export function evaluatePolicy(
  rules: PolicyRule[],
  toolName: string,
): "allow" | "deny" | "require_approval" {
  const rank = { deny: 2, require_approval: 1, allow: 0 } as const;
  const matches = rules.filter(
    (rule) =>
      rule.enabled &&
      new RegExp(`^${rule.toolMatch.split("*").map(escapeRe).join(".*")}$`).test(toolName),
  );
  if (matches.length === 0) return "deny";
  matches.sort((a, b) => b.priority - a.priority || rank[b.effect] - rank[a.effect]);
  return matches[0]!.effect;
}

function escapeRe(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}
