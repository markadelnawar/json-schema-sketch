import type { SchemaNode, InferOptions } from "./types.js";

/** Infer a SchemaNode tree from an arbitrary JSON value. */
export function inferSchema(value: unknown, options?: InferOptions): SchemaNode {
  const opts: Required<InferOptions> = { maxDepth: 10, mode: "sampled", ...options };
  return _infer(value, 0, opts);
}

function _infer(value: unknown, depth: number, opts: Required<InferOptions>): SchemaNode {
  if (value === null || value === undefined) {
    return { type: "null" };
  }

  switch (typeof value) {
    case "boolean":
      return { type: "boolean" };
    case "number":
      return { type: "number" };
    case "string":
      return { type: "string", length: (value as string).length };
    case "object":
      if (Array.isArray(value)) return _inferArray(value, depth, opts);
      return _inferObject(value as Record<string, unknown>, depth, opts);
  }

  return { type: "null" };
}

function _inferArray(value: unknown[], depth: number, opts: Required<InferOptions>): SchemaNode {
  if (value.length === 0) {
    return { type: "array", count: 0 };
  }

  if (depth >= opts.maxDepth) {
    return { type: "array", count: value.length };
  }

  if (opts.mode === "exhaustive") {
    return _inferArrayExhaustive(value, depth, opts);
  }

  return _inferArraySampled(value, depth, opts);
}

function _inferArrayExhaustive(value: unknown[], depth: number, opts: Required<InferOptions>): SchemaNode {
  const samples = value.map((item) => _infer(item, depth + 1, opts));
  const merged = samples.length === 1 ? samples[0] : mergeSchemas(samples);

  if (merged.type === "object" && merged.keys) {
    const keyCounts = new Map<string, number>();
    for (const item of value) {
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        for (const k of Object.keys(item as Record<string, unknown>)) {
          keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1);
        }
      }
    }

    for (const key of Object.keys(merged.keys)) {
      const count = keyCounts.get(key) ?? 0;
      if (count < value.length) {
        merged.keys[key].optional = true;
      }
    }

    markVaryingArraySizes(merged.keys, value as Record<string, unknown>[]);
  }

  return { type: "array", items: merged, count: value.length };
}

/** Sample up to 3 elements and merge their inferred schemas. */
function _sampleAndMerge(value: unknown[], depth: number, opts: Required<InferOptions>): SchemaNode {
  const sampleIndices = pickSampleIndices(value.length, 3);
  const samples = sampleIndices.map((i) => _infer(value[i], depth + 1, opts));
  if (samples.length === 1 || allSameShape(samples)) return samples[0];
  return mergeSchemas(samples);
}

function _inferArraySampled(value: unknown[], depth: number, opts: Required<InferOptions>): SchemaNode {
  if (typeof value[0] !== "object" || value[0] === null || Array.isArray(value[0])) {
    return { type: "array", items: _sampleAndMerge(value, depth, opts), count: value.length };
  }

  // Array of objects: sample for types, but scan ALL elements for key discovery
  const merged = _sampleAndMerge(value, depth, opts);

  if (merged.type !== "object" || !merged.keys) {
    return { type: "array", items: merged, count: value.length };
  }

  // Single pass: collect key counts and donor elements for keys missing from sample
  const keyCounts = new Map<string, number>();
  const donors = new Map<string, Record<string, unknown>>();
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    for (const k of Object.keys(item as Record<string, unknown>)) {
      keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1);
      if (!donors.has(k)) donors.set(k, item as Record<string, unknown>);
    }
  }

  // Add keys missing from the sample via donor elements
  for (const [key, donor] of donors) {
    if (!(key in merged.keys)) {
      merged.keys[key] = _infer(donor[key], depth + 1, opts);
    }
  }

  // Mark keys that don't appear in every element as optional
  for (const key of Object.keys(merged.keys)) {
    const count = keyCounts.get(key) ?? 0;
    if (count < value.length) {
      merged.keys[key].optional = true;
    }
  }

  markVaryingArraySizes(merged.keys, value as Record<string, unknown>[]);

  return { type: "array", items: merged, count: value.length };
}

function _inferObject(value: Record<string, unknown>, depth: number, opts: Required<InferOptions>): SchemaNode {
  if (depth >= opts.maxDepth) {
    return { type: "object" };
  }

  const keys: Record<string, SchemaNode> = {};
  for (const [k, v] of Object.entries(value)) {
    keys[k] = _infer(v, depth + 1, opts);
  }
  return { type: "object", keys };
}

/** Pick up to maxSamples indices spread across an array (first, middle, last). */
function pickSampleIndices(length: number, maxSamples: number): number[] {
  if (length <= maxSamples) {
    return Array.from({ length }, (_, i) => i);
  }
  const indices = [0];
  if (maxSamples >= 3) {
    indices.push(Math.floor(length / 2));
  }
  if (maxSamples >= 2) {
    indices.push(length - 1);
  }
  return indices;
}

/** Check if all schemas have the same shape (same type + same keys). */
function allSameShape(schemas: SchemaNode[]): boolean {
  if (schemas.length <= 1) return true;
  const first = JSON.stringify(schemaShape(schemas[0]));
  return schemas.every((s) => JSON.stringify(schemaShape(s)) === first);
}

/** Extract just the structural shape (types + key names, no values). */
function schemaShape(node: SchemaNode): unknown {
  if (node.type === "object" && node.keys) {
    const shape: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node.keys)) {
      shape[k] = schemaShape(v);
    }
    return { t: "object", k: shape };
  }
  if (node.type === "array" && node.items) {
    return { t: "array", i: schemaShape(node.items) };
  }
  return { t: node.type };
}

/** Merge multiple schemas into a single unified schema. */
function mergeSchemas(schemas: SchemaNode[]): SchemaNode {
  const types = new Set(schemas.map((s) => s.type));
  if (types.size === 1) {
    return mergeSameType(schemas);
  }

  // Group by type, merge each group, then union the distinct results
  const groups = new Map<string, SchemaNode[]>();
  for (const s of schemas) {
    if (!groups.has(s.type)) groups.set(s.type, []);
    groups.get(s.type)!.push(s);
  }

  const variants: SchemaNode[] = [];
  for (const group of groups.values()) {
    const merged = mergeSameType(group);
    merged.variantCount = group.length;
    variants.push(merged);
  }

  return variants.length === 1 ? variants[0] : { type: "union", variants };
}

/** Merge schemas that all share the same type. */
function mergeSameType(schemas: SchemaNode[]): SchemaNode {
  if (schemas[0].type === "object") {
    const allKeys = new Map<string, SchemaNode[]>();
    for (const s of schemas) {
      if (s.keys) {
        for (const [k, v] of Object.entries(s.keys)) {
          if (!allKeys.has(k)) allKeys.set(k, []);
          allKeys.get(k)!.push(v);
        }
      }
    }
    const merged: Record<string, SchemaNode> = {};
    for (const [k, vs] of allKeys) {
      merged[k] = vs.length === 1 ? vs[0] : mergeSchemas(vs);
    }
    return { type: "object", keys: merged };
  }

  if (schemas[0].type === "array") {
    const itemSchemas = schemas.filter((s) => s.items).map((s) => s.items!);
    const items = itemSchemas.length === 0
      ? undefined
      : itemSchemas.length === 1
        ? itemSchemas[0]
        : mergeSchemas(itemSchemas);

    const counts = schemas.map((s) => s.count ?? 0);
    const allSameCount = counts.every((c) => c === counts[0]);

    const result: SchemaNode = { type: "array", items };
    if (allSameCount) {
      result.count = counts[0];
    } else {
      result.varyingSizes = true;
    }
    return result;
  }

  return schemas[0];
}

/**
 * For each key in the merged item schema that is an array, check if its length
 * varies across the parent array's elements. If so, mark it as varyingSizes
 * and drop the misleading count.
 */
function markVaryingArraySizes(keys: Record<string, SchemaNode>, elements: Record<string, unknown>[]): void {
  for (const [key, schema] of Object.entries(keys)) {
    if (schema.type !== "array") continue;

    let firstSize: number | null = null;
    let varies = false;

    for (const el of elements) {
      if (el === null || typeof el !== "object") continue;
      const val = el[key];
      if (!Array.isArray(val)) continue;

      if (firstSize === null) {
        firstSize = val.length;
      } else if (val.length !== firstSize) {
        varies = true;
        break;
      }
    }

    if (varies) {
      schema.varyingSizes = true;
      delete schema.count;
    }
  }
}
