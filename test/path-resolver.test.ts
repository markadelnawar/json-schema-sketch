import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolvePath } from "../src/path-resolver.js";

const sampleData = {
  data: {
    users: [
      { id: 1, name: "Alice", email: "alice@test.com" },
      { id: 2, name: "Bob", email: "bob@test.com" },
      { id: 3, name: "Charlie", email: "charlie@test.com" },
    ],
  },
  meta: { page: 1, total: 50 },
};

describe("resolvePath", () => {
  it("resolves root", () => {
    const result = resolvePath(sampleData, "");
    assert.ok(result.ok);
    assert.deepEqual(result.value, sampleData);
  });

  it("resolves simple key", () => {
    const result = resolvePath(sampleData, "meta");
    assert.ok(result.ok);
    assert.deepEqual(result.value, { page: 1, total: 50 });
  });

  it("resolves nested key", () => {
    const result = resolvePath(sampleData, "meta.total");
    assert.ok(result.ok);
    assert.equal(result.value, 50);
  });

  it("resolves array index", () => {
    const result = resolvePath(sampleData, "data.users[0].name");
    assert.ok(result.ok);
    assert.equal(result.value, "Alice");
  });

  it("resolves wildcard", () => {
    const result = resolvePath(sampleData, "data.users[*].id");
    assert.ok(result.ok);
    assert.deepEqual(result.value, [1, 2, 3]);
    assert.equal(result.isWildcard, true);
    assert.equal(result.totalItems, 3);
  });

  it("respects maxItems for wildcards", () => {
    const result = resolvePath(sampleData, "data.users[*].name", 2);
    assert.ok(result.ok);
    assert.deepEqual(result.value, ["Alice", "Bob"]);
    assert.equal(result.totalItems, 3);
  });

  it("returns error for missing key", () => {
    const result = resolvePath(sampleData, "data.nonexistent");
    assert.ok(!result.ok);
    assert.ok(result.error.includes("not found"));
  });

  it("returns error for out-of-bounds index", () => {
    const result = resolvePath(sampleData, "data.users[99]");
    assert.ok(!result.ok);
    assert.ok(result.error.includes("out of bounds"));
  });

  it("returns error for key access on non-object", () => {
    const result = resolvePath(sampleData, "meta.total.something");
    assert.ok(!result.ok);
    assert.ok(result.error.includes("Cannot access key"));
  });

  it("returns error for wildcard on non-array", () => {
    const result = resolvePath(sampleData, "meta[*]");
    assert.ok(!result.ok);
    assert.ok(result.error.includes("wildcard"));
  });

  it("resolves nested wildcard with nested key", () => {
    const result = resolvePath(sampleData, "data.users[*].email");
    assert.ok(result.ok);
    assert.deepEqual(result.value, ["alice@test.com", "bob@test.com", "charlie@test.com"]);
    assert.equal(result.isWildcard, true);
  });

  it("resolves full sub-tree (shallow path returns entire object)", () => {
    const result = resolvePath(sampleData, "data.users[0]");
    assert.ok(result.ok);
    assert.deepEqual(result.value, { id: 1, name: "Alice", email: "alice@test.com" });
    assert.equal(result.isWildcard, false);
  });

  it("resolves array directly (no wildcard)", () => {
    const result = resolvePath(sampleData, "data.users");
    assert.ok(result.ok);
    assert.ok(Array.isArray(result.value));
    assert.equal((result.value as unknown[]).length, 3);
    assert.equal(result.isWildcard, false);
  });
});
