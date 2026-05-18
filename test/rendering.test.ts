import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inferSchema } from "../src/inference.js";
import { renderSchema } from "../src/rendering.js";

describe("renderSchema", () => {
  it("renders a flat object compactly", () => {
    const schema = inferSchema({ name: "test", count: 42 });
    const output = renderSchema(schema);
    assert.ok(output.includes("name: string"));
    assert.ok(output.includes("count: number"));
  });

  it("renders array of objects", () => {
    const schema = inferSchema({
      users: [{ id: 1, name: "Alice" }],
    });
    const output = renderSchema(schema);
    assert.ok(output.includes("array(1)"));
    assert.ok(output.includes("id: number"));
    assert.ok(output.includes("name: string"));
  });

  it("renders nested response compactly with massive token savings", () => {
    const response = getSubscriptionPlans();
    const rawSize = JSON.stringify(response).length;
    const schema = inferSchema(response);
    const output = renderSchema(schema);

    // Raw JSON is large, schema should be a fraction
    assert.ok(
      output.length < rawSize / 5,
      `Schema (${output.length} chars) should be much smaller than raw JSON (${rawSize} chars)`,
    );

    // Should mention it's 4 plans
    assert.ok(output.includes("array(4)"), "Should show plans count");

    // Should show nested features structure
    assert.ok(output.includes("features:"), "Should show features key");
    assert.ok(output.includes("icon: string"), "Should show features.icon type");
    assert.ok(output.includes("text: string"), "Should show features.text type");

    // Should show price as number, not dump the actual value
    assert.ok(output.includes("price: number"), "Should show price type");
    assert.ok(!output.includes("9.99"), "Should NOT contain actual price values");
    assert.ok(!output.includes("example.com"), "Should NOT contain actual URL values");

    // Default: no string lengths
    assert.ok(!output.includes("string("), "Default should NOT show string lengths");

    // With showStringLengths: true
    const withLengths = renderSchema(schema, { showStringLengths: true });
    assert.ok(withLengths.includes("string("), "showStringLengths should include lengths");
    assert.ok(withLengths.includes("price: number"), "Numbers should be unaffected by flag");
  });

  it("renders nested response with controlled depth", () => {
    const response = getSubscriptionPlans();

    // At depth 2, plans items should be opaque objects
    const shallow = inferSchema(response, { maxDepth: 2 });
    const shallowOutput = renderSchema(shallow);

    // plans array should exist but items won't have expanded keys
    assert.ok(shallowOutput.includes("array(4)"), "Should still show array count");

    // At full depth, we get the nested feature details
    const deep = inferSchema(response, { maxDepth: 6 });
    const deepOutput = renderSchema(deep);
    assert.ok(deepOutput.includes("icon: string"), "Deep render should show features.icon");

    // Deeper output is longer but still way smaller than raw
    assert.ok(deepOutput.length > shallowOutput.length, "Deeper schema should be more detailed");
    assert.ok(
      deepOutput.length < JSON.stringify(response).length / 3,
      "Even deep schema should be much smaller than raw JSON",
    );
  });

  it("renders stringLabel with and without showStringLengths", () => {
    const schema = inferSchema("hello");
    assert.equal(renderSchema(schema), "string");
    assert.equal(renderSchema(schema, { showStringLengths: true }), "string(5)");
  });

  it("renders arrayLabel with count and varying sizes", () => {
    const output = renderSchema(inferSchema({ items: [1, 2, 3] }));
    assert.ok(output.includes("array(3)"));

    const varying = renderSchema(inferSchema([
      { tags: ["a", "b", "c"] },
      { tags: ["x"] },
    ]));
    assert.ok(varying.includes("array(varying sizes)"));
  });

  it("renders object inline when small enough", () => {
    const output = renderSchema(inferSchema({ meta: { page: 1, total: 50 } }));
    assert.equal(output, "meta: {page: number, total: number}");
  });

  it("expands object with dot-paths when too wide", () => {
    const output = renderSchema(inferSchema({
      meta: { page: 1, total: 50, per_page: 25, has_next: true, cursor: "abc123xyz" },
    }));
    assert.ok(output.includes("meta.page: number"));
    assert.ok(output.includes("meta.total: number"));
    assert.ok(output.includes("meta.cursor: string"));
    assert.ok(!output.includes("{page:"), "Should NOT render inline");
  });

  it("renders empty array as empty", () => {
    const output = renderSchema(inferSchema({ items: [] }));
    assert.equal(output, "items: array(0) empty");
  });

  it("renders empty object as {}", () => {
    const output = renderSchema(inferSchema({ config: {} }));
    assert.equal(output, "config: {}");
  });

  it("renders all primitive types", () => {
    const output = renderSchema(inferSchema({ s: "hi", n: 42, b: true, x: null }));
    assert.ok(output.includes("s: string"));
    assert.ok(output.includes("n: number"));
    assert.ok(output.includes("b: boolean"));
    assert.ok(output.includes("x: null"));
  });

  it("renders union with variant counts", () => {
    const schema = inferSchema(
      [{ id: 1 }, { id: 2 }, { id: 3 }, "stray", [99]],
      { mode: "exhaustive" },
    );
    const output = renderSchema(schema);
    assert.ok(output.includes("{id: number}(×3)"), "Should show object count");
    assert.ok(output.includes("| string"), "Should show string variant");
    assert.ok(output.includes("| array(1) of number"), "Should show array variant");
  });

  it("renders array of objects multi-line when too wide", () => {
    const schema = inferSchema({
      users: [{
        id: 1,
        first_name: "Alice",
        last_name: "Smith",
        email: "alice@test.com",
        phone: "+1234567890",
        role: "admin",
        department: "engineering",
        status: "active",
      }],
    });
    const output = renderSchema(schema);
    assert.ok(output.includes("users: array(1) of {"));
    assert.ok(output.includes("  id: number"));
    assert.ok(output.includes("  email: string"));
    assert.ok(output.includes("}"));
  });

  it("renders optional keys with tag", () => {
    const schema = inferSchema([
      { id: 1, name: "Alice" },
      { id: 2 },
    ]);
    const output = renderSchema(schema);
    assert.ok(output.includes("(optional) string"), "name should be optional");
    assert.ok(!output.includes("(optional) number"), "id should NOT be optional");
  });

  it("renders nested dot-paths for deeply nested objects", () => {
    const output = renderSchema(inferSchema({
      product: {
        details: {
          manufacturer: "Acme",
          model: "Widget X",
          specs: { ram: "8GB", storage: "128GB", color: "blue" },
        },
      },
    }));
    assert.ok(output.includes("product.details.manufacturer: string"));
    assert.ok(output.includes("product.details.model: string"));
    assert.ok(output.includes("product.details.specs: {ram: string, storage: string, color: string}"));
  });

  it("renders root object expanded (no inline)", () => {
    const output = renderSchema(inferSchema({ a: 1, b: "x" }));
    assert.equal(output, "a: number\nb: string");
  });

  it("renders non-object array items inline", () => {
    const output = renderSchema(inferSchema({ tags: ["a", "b", "c"] }));
    assert.equal(output, "tags: array(3) of string");
  });

  it("full flow: array inline with optional keys", () => {
    const output = renderSchema(inferSchema([{ id: 1, name: "Alice" }, { id: 2 }]));
    assert.equal(output, "array(2) of {id: number, name: (optional) string}");
  });

  it("full flow: array multi-line when inline exceeds 120 chars", () => {
    const output = renderSchema(inferSchema({
      users: [{ id: 1, first_name: "A", last_name: "B", email: "a@b.com", phone: "123", role: "admin", dept: "eng", status: "active" }],
    }));
    assert.equal(output, [
      "users: array(1) of {",
      "  id: number",
      "  first_name: string",
      "  last_name: string",
      "  email: string",
      "  phone: string",
      "  role: string",
      "  dept: string",
      "  status: string",
      "}",
    ].join("\n"));
  });

  it("full flow: varying array sizes", () => {
    const output = renderSchema(inferSchema([{ tags: ["a", "b", "c"] }, { tags: ["x"] }]));
    assert.equal(output, "array(2) of {tags: array(varying sizes) of string}");
  });

  it("full flow: union with variant counts", () => {
    const output = renderSchema(inferSchema(
      [{ id: 1 }, { id: 2 }, { id: 3 }, "stray", [99]],
      { mode: "exhaustive" },
    ));
    assert.equal(output, "array(5) of {id: number}(×3) | string | array(1) of number");
  });

  it("full flow: dot-path expansion for wide nested object", () => {
    const output = renderSchema(inferSchema({
      product: { name: "Widget X", brand: "Acme", price: 999, stock: 50, category: "phones", sku: "ABC123" },
    }));
    assert.equal(output, [
      "product.name: string",
      "product.brand: string",
      "product.price: number",
      "product.stock: number",
      "product.category: string",
      "product.sku: string",
    ].join("\n"));
  });

  it("full flow: nested object stays inline when small enough", () => {
    const output = renderSchema(inferSchema({
      product: { details: { manufacturer: "Acme", model: "Widget X" }, price: 999 },
    }));
    assert.equal(output, "product: {details: {manufacturer: string, model: string}, price: number}");
  });

  it("full flow: same key as array and object across elements", () => {
    const output = renderSchema(inferSchema([
      { code: "cat1", children: [{ id: 1, name: "Phones" }, { id: 2, name: "Laptops" }] },
      { code: "cat2", children: { featured: "Shoes", count: 10 } },
      { code: "cat3", children: [{ id: 3, name: "TVs" }] },
    ], { mode: "exhaustive" }));
    assert.ok(output.includes("array(varying sizes) of {id: number, name: string}(×2)"));
    assert.ok(output.includes("| {featured: string, count: number}"));
  });

  it("full flow: showStringLengths on union output", () => {
    const output = renderSchema(
      inferSchema([{ value: "hello" }, { value: 42 }], { mode: "exhaustive" }),
      { showStringLengths: true },
    );
    assert.ok(output.includes("string(5)"));
    assert.ok(output.includes("number"));
  });

  it("produces compact output for a large response", () => {
    // Simulate a 25-element array — schema should be tiny
    const items = Array.from({ length: 25 }, (_, i) => ({
      id: i,
      name: `User ${i}`,
      email: `user${i}@test.com`,
    }));
    const schema = inferSchema({ data: items, total: 25 });
    const output = renderSchema(schema);

    // The rendered schema should be much smaller than the raw JSON
    const rawSize = JSON.stringify({ data: items, total: 25 }).length;
    assert.ok(
      output.length < rawSize / 5,
      `Schema (${output.length} chars) should be much smaller than raw JSON (${rawSize} chars)`,
    );
    assert.ok(output.includes("array(25)"));
  });
});

function getSubscriptionPlans() {
  const makePlan = (code: string, duration: string, name: string, price: number, tags: string[], featureTexts: string[], animationUrl: string) => ({
    planCode: code,
    duration,
    planImage: "https://example.com/images/plan-hero.png",
    planIcon: "https://example.com/images/plan-icon.png",
    planName: name,
    tags,
    price,
    features: featureTexts.map((text) => ({
      icon: "https://example.com/icons/check.png",
      text,
    })),
    animationUrl,
    ctaText: "SELECT",
    selectedCtaText: "SELECTED",
    selectedCtaIcon: "https://example.com/icons/tick.png",
    providerId: 1,
  });

  return {
    title: "Choose a Plan",
    subtitle: [
      "Trusted by 1000+ users",
      "Cancel anytime",
      "Priority support included",
    ],
    bannerUrl: "https://example.com/banners/promo.json",
    plans: [
      makePlan("PLAN_BASIC_1M", "1 MONTH", "Basic Plan", 9.99, ["#ffffff", "#E0FFF2"],
        ["Up to 5 projects", "Basic analytics", "Email support"],
        "https://example.com/animations/basic.json"),
      makePlan("PLAN_BASIC_1Y", "1 YEAR", "Basic Plan", 99.0, ["#ffffff", "#E0FFF2"],
        ["Up to 5 projects", "Basic analytics", "Email support"],
        "https://example.com/animations/basic.json"),
      makePlan("PLAN_PRO_1M", "1 MONTH", "Pro Plan", 29.99, ["#ffffff", "#fff2d9"],
        ["Unlimited projects", "Advanced analytics", "Priority support"],
        "https://example.com/animations/pro.json"),
      makePlan("PLAN_TEAM_1Y", "1 YEAR + TEAM", "Team Plan", 199.0, ["#ffffff", "#E8FBFF"],
        ["Everything in Pro", "Team collaboration", "Custom integrations"],
        "https://example.com/animations/team.json"),
    ],
  };
}
