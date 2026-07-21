import { describe, expect, it } from "vitest";
import { canonicalJson, hashArgs } from "./hash.js";

describe("canonicalJson", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(canonicalJson({ z: { d: 4, c: 3 }, a: { b: 2, a: 1 } })).toBe(
      '{"a":{"a":1,"b":2},"z":{"c":3,"d":4}}',
    );
  });
});

describe("hashArgs", () => {
  it("produces the same hash regardless of object key order", () => {
    expect(hashArgs({ a: 1, b: 2 })).toBe(hashArgs({ b: 2, a: 1 }));
    expect(hashArgs({ outer: { a: 1, b: 2 } })).toBe(hashArgs({ outer: { b: 2, a: 1 } }));
  });

  it("keeps array order significant", () => {
    expect(hashArgs([1, 2, 3])).not.toBe(hashArgs([3, 2, 1]));
  });

  it("changes when values change", () => {
    expect(hashArgs({ amount: 1 })).not.toBe(hashArgs({ amount: 2 }));
  });
});
