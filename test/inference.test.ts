import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inferSchema } from "../src/inference.js";

describe("inferSchema", () => {
  it("handles primitives", () => {
    assert.deepEqual(inferSchema(null), { type: "null" });
    assert.deepEqual(inferSchema(42), { type: "number" });
    assert.deepEqual(inferSchema(true), { type: "boolean" });
    assert.deepEqual(inferSchema("hello"), { type: "string", length: 5 });
  });

  it("handles empty array", () => {
    assert.deepEqual(inferSchema([]), { type: "array", count: 0 });
  });

  it("handles homogeneous array of primitives", () => {
    const schema = inferSchema([1, 2, 3]);
    assert.equal(schema.type, "array");
    assert.equal(schema.count, 3);
    assert.equal(schema.items?.type, "number");
  });

  it("handles array of objects", () => {
    const data = [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ];
    const schema = inferSchema(data);
    assert.equal(schema.type, "array");
    assert.equal(schema.count, 2);
    assert.equal(schema.items?.type, "object");
    assert.equal(schema.items?.keys?.id.type, "number");
    assert.equal(schema.items?.keys?.name.type, "string");
  });

  it("handles nested objects", () => {
    const data = {
      user: { name: "Alice", preferences: { theme: "dark" } },
    };
    const schema = inferSchema(data);
    assert.equal(schema.type, "object");
    assert.equal(schema.keys?.user.type, "object");
    assert.equal(schema.keys?.user.keys?.preferences.type, "object");
    assert.equal(schema.keys?.user.keys?.preferences.keys?.theme.type, "string");
  });

  it("respects maxDepth", () => {
    const deep = { a: { b: { c: { d: { e: "deep" } } } } };
    const schema = inferSchema(deep, { maxDepth: 2 });
    // At depth 2, should stop expanding
    assert.equal(schema.keys?.a.keys?.b.type, "object");
    assert.equal(schema.keys?.a.keys?.b.keys, undefined);
  });

  it("handles nested API response with plans and features", () => {
    const response = getSubscriptionPlans();
    const schema = inferSchema(response);

    // Top-level keys
    assert.equal(schema.type, "object");
    assert.equal(schema.keys?.title.type, "string");
    assert.equal(schema.keys?.bannerUrl.type, "string");

    // subtitle is array of strings
    assert.equal(schema.keys?.subtitle.type, "array");
    assert.equal(schema.keys?.subtitle.count, 3);
    assert.equal(schema.keys?.subtitle.items?.type, "string");

    // plans is array of objects
    const plans = schema.keys?.plans;
    assert.equal(plans?.type, "array");
    assert.equal(plans?.count, 4);
    assert.equal(plans?.items?.type, "object");

    // plan item has expected keys
    const planKeys = plans?.items?.keys;
    assert.ok(planKeys);
    assert.equal(planKeys.planCode.type, "string");
    assert.equal(planKeys.duration.type, "string");
    assert.equal(planKeys.price.type, "number");
    assert.equal(planKeys.providerId.type, "number");

    // nested: tags is array of strings
    assert.equal(planKeys.tags.type, "array");
    assert.equal(planKeys.tags.items?.type, "string");

    // nested: features is array of objects with icon + text
    assert.equal(planKeys.features.type, "array");
    assert.equal(planKeys.features.count, 3);
    assert.equal(planKeys.features.items?.type, "object");
    assert.equal(planKeys.features.items?.keys?.icon.type, "string");
    assert.equal(planKeys.features.items?.keys?.text.type, "string");

    // At maxDepth=5, feature items (depth 5) ARE fully expanded
    const shallowSchema = inferSchema(response, { maxDepth: 5 });
    const shallowFeatures = shallowSchema.keys?.plans?.items?.keys?.features;
    assert.equal(shallowFeatures?.items?.type, "object");
    assert.equal(shallowFeatures?.items?.keys?.icon.type, "string");
    assert.equal(shallowFeatures?.items?.keys?.text.type, "string");

    // At maxDepth=1, plans array itself hits the depth limit and becomes count-only
    const veryShallow = inferSchema(response, { maxDepth: 1 });
    assert.equal(veryShallow.keys?.plans?.type, "array");
    assert.equal(veryShallow.keys?.plans?.count, 4);
    assert.equal(veryShallow.keys?.plans?.items, undefined, "At maxDepth=1, plans has no item schema");
  });

  it("discovers optional keys that only appear in some array elements", () => {
    const filters = [
      { name: "Status", code: "status", group: "main", icon_on: "url1", icon_off: "url2" },
      { name: "Priority", code: "priority", group: "main", icon_on: "url3", icon_off: "url4" },
      { name: "Type", code: "type", group: "main", icon_on: "url5", icon_off: "url6" },
      { name: "Open", code: "open", group: "status" },
      { name: "Closed", code: "closed", group: "status" },
      { name: "Large", code: "large", group: "size", label: "File Size" },
    ];
    const schema = inferSchema(filters);

    assert.equal(schema.type, "array");
    assert.equal(schema.count, 6);

    // "label" only appears on element 5 — must still be discovered
    const keys = schema.items?.keys;
    assert.ok(keys);
    assert.equal(keys.name.type, "string");
    assert.equal(keys.code.type, "string");
    assert.equal(keys.group.type, "string");
    assert.equal(keys.label?.type, "string", "label key must be discovered even though it only appears on element 5");
    assert.equal(keys.icon_on?.type, "string");
    assert.equal(keys.icon_off?.type, "string");
  });

  it("handles a realistic API response", () => {
    const apiResponse = {
      data: {
        users: [
          {
            id: 1,
            name: "Alice",
            email: "alice@example.com",
            preferences: { theme: "dark", lang: "en" },
          },
        ],
      },
      meta: { page: 1, total: 50, per_page: 25 },
    };
    const schema = inferSchema(apiResponse);
    assert.equal(schema.type, "object");
    assert.equal(schema.keys?.data.keys?.users.type, "array");
    assert.equal(schema.keys?.data.keys?.users.count, 1);
    assert.equal(schema.keys?.meta.keys?.total.type, "number");
  });

  it("exhaustive mode catches mixed-type elements that sampling misses", () => {
    // With 5 elements, sampled picks indices [0, 2, 4] — all objects.
    // The string at index 3 is invisible to sampled mode.
    const data = [{ id: 1 }, { id: 2 }, { id: 3 }, "oops", { id: 5 }];

    const sampled = inferSchema(data, { mode: "sampled" });
    // Sampled misses the string — reports pure object array
    assert.equal(sampled.items?.type, "object");

    const exhaustive = inferSchema(data, { mode: "exhaustive" });
    // Exhaustive catches the string — reports a union
    assert.equal(exhaustive.items?.type, "union");
    const types = exhaustive.items?.variants?.map((v) => v.type);
    assert.ok(types?.includes("string"), "Should detect the string element");
    assert.ok(types?.includes("object"), "Should detect the object elements");
  });

  it("exhaustive mode infers all elements in non-object arrays", () => {
    // 7 elements — sampled picks [0, 3, 6] which are all numbers.
    // The boolean at index 1 is only visible to exhaustive.
    const data = [1, true, 2, 3, 4, 5, 6];

    const sampled = inferSchema(data, { mode: "sampled" });
    assert.equal(sampled.items?.type, "number", "sampled misses the boolean at index 1");

    const exhaustive = inferSchema(data, { mode: "exhaustive" });
    assert.equal(exhaustive.items?.type, "union");
    const types = exhaustive.items?.variants?.map((v) => v.type);
    assert.ok(types?.includes("number"));
    assert.ok(types?.includes("boolean"));
  });

  it("handles mixed array of object, string, and array", () => {
    const data = [{ id: 1, name: "Alice" }, "hello", [10, 20, 30]];
    const schema = inferSchema(data, { mode: "exhaustive" });

    assert.equal(schema.type, "array");
    assert.equal(schema.count, 3);
    assert.equal(schema.items?.type, "union");

    const types = schema.items?.variants?.map((v) => v.type);
    assert.equal(types?.length, 3, "Should have exactly 3 distinct variants");
    assert.ok(types?.includes("object"));
    assert.ok(types?.includes("string"));
    assert.ok(types?.includes("array"));

    // Verify the nested types are correct
    const objVariant = schema.items?.variants?.find((v) => v.type === "object");
    assert.equal(objVariant?.keys?.id.type, "number");
    assert.equal(objVariant?.keys?.name.type, "string");

    const arrVariant = schema.items?.variants?.find((v) => v.type === "array");
    assert.equal(arrVariant?.items?.type, "number");
    assert.equal(arrVariant?.count, 3);
  });

  it("deduplicates union variants by merging same-type schemas", () => {
    // 5 elements — 3 objects, 1 string, 1 array. Objects should merge into one variant.
    const data = [{ id: 1 }, { id: 2 }, "stray", [99], { id: 4 }];
    const schema = inferSchema(data, { mode: "exhaustive" });

    assert.equal(schema.items?.type, "union");
    const types = schema.items?.variants?.map((v) => v.type);
    assert.equal(types?.length, 3, "Should deduplicate 3 objects into 1 variant");
    assert.deepEqual(types?.sort(), ["array", "object", "string"]);

    // The merged object should have the id key from all 3 objects
    const objVariant = schema.items?.variants?.find((v) => v.type === "object");
    assert.equal(objVariant?.keys?.id.type, "number");
  });

  it("handles deeply nested structures at default maxDepth", () => {
    // Real-world CMS pattern: top object → data array → item → modules array → module → banners array → banner object
    // That's 7 levels deep — the banner object must still have its keys expanded
    const data = {
      type: "static",
      data: [
        {
          modules: [
            {
              type: "recentlySearched",
              banners: [
                { imageUrl: "abc", title: "test" },
                { imageUrl: "def", title: "test2" },
              ],
            },
          ],
        },
      ],
    };

    const schema = inferSchema(data);
    const banners = schema.keys?.data?.items?.keys?.modules?.items?.keys?.banners;

    assert.equal(banners?.type, "array");
    assert.equal(banners?.count, 2);
    assert.equal(banners?.items?.type, "object");
    assert.ok(banners?.items?.keys, "Banner objects should have keys at default maxDepth");
    assert.equal(banners?.items?.keys?.imageUrl.type, "string");
    assert.equal(banners?.items?.keys?.title.type, "string");
  });

  it("merges array schemas with varying sizes and mixed data types (facets pattern)", () => {
    const data = {
      facets: [
        { code: "shipping", type: "shipping", data: [
          { name: "Fast", code: "fast", count: 0, title: "Same day", description: "fastest option" },
          { name: "Standard", code: "standard", count: 0, title: "3-5 days", description: "regular" },
          { name: "Economy", code: "economy", count: 0, title: "7-10 days", description: "cheapest" },
        ]},
        { code: "vendor", type: "vendor", data: [
          { name: "Vendor A", code: "vendor_a", count: 0 },
          { name: "Vendor B", code: "vendor_b", count: 0 },
        ]},
        { code: "price", type: "price", data: { max: 1799, min: 19 } },
        { code: "rating", type: "rating", data: { "1.0": 0, "5.0": 0 } },
        { code: "special", type: "custom", data: "some-string-value" },
        { code: "category", type: "category", data: [
          { id_category: 1, code: "tools", children: [
            { id_category: 10, code: "drills", count: 5, name: "Drills" },
            { id_category: 11, code: "saws", count: 3, name: "Saws" },
          ], count: 8, name: "Tools" },
        ]},
      ],
    };
    const schema = inferSchema(data, { mode: "exhaustive" });
    const facetItems = schema.keys?.facets?.items;
    assert.ok(facetItems?.keys);

    // data field should be a union: array | object | string
    const dataField = facetItems.keys.data;
    assert.equal(dataField.type, "union");
    const variantTypes = dataField.variants!.map((v) => v.type).sort();
    assert.deepEqual(variantTypes, ["array", "object", "string"]);

    // The array variant should have varyingSizes (3, 2, 1 elements)
    const arrVariant = dataField.variants!.find((v) => v.type === "array")!;
    assert.equal(arrVariant.varyingSizes, true, "Array data should have varying sizes");
    assert.equal(arrVariant.count, undefined, "Count should be removed when varying");

    // The array variant items should have merged keys from all array-data facets
    const itemKeys = Object.keys(arrVariant.items?.keys || {});
    assert.ok(itemKeys.includes("name"), "Should have name from vendor/shipping");
    assert.ok(itemKeys.includes("title"), "Should have title from shipping");
    assert.ok(itemKeys.includes("id_category"), "Should have id_category from category");
    assert.ok(itemKeys.includes("children"), "Should have children from category");

    // The object variant should merge price + rating keys
    const objVariant = dataField.variants!.find((v) => v.type === "object")!;
    assert.ok(objVariant.keys?.max, "Should have max from price");
    assert.ok(objVariant.keys?.min, "Should have min from price");
    assert.ok(objVariant.keys?.["1.0"], "Should have 1.0 from rating");
  });

  it("handles same key as array in one element and object in another", () => {
    const data = [
      { code: "cat1", children: [{ id: 1, name: "Phones" }, { id: 2, name: "Laptops" }] },
      { code: "cat2", children: { featured: "Shoes", count: 10 } },
      { code: "cat3", children: [{ id: 3, name: "TVs" }] },
    ];
    const schema = inferSchema(data, { mode: "exhaustive" });
    const children = schema.items?.keys?.children;

    // children should be a union of array and object
    assert.equal(children?.type, "union");
    const types = children?.variants?.map((v) => v.type).sort();
    assert.deepEqual(types, ["array", "object"]);

    // Array variant: appeared twice, varying sizes (2 and 1)
    const arrVariant = children?.variants?.find((v) => v.type === "array")!;
    assert.equal(arrVariant.variantCount, 2);
    assert.equal(arrVariant.varyingSizes, true);
    assert.equal(arrVariant.items?.keys?.id.type, "number");
    assert.equal(arrVariant.items?.keys?.name.type, "string");

    // Object variant: appeared once
    const objVariant = children?.variants?.find((v) => v.type === "object")!;
    assert.equal(objVariant.variantCount, 1);
    assert.equal(objVariant.keys?.featured.type, "string");
    assert.equal(objVariant.keys?.count.type, "number");
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
