/**
 * Resolves dot/bracket notation paths against parsed JSON values.
 *
 * Supported syntax:
 *   data.users        → navigates into nested objects
 *   data.users[0]     → array index access
 *   data.users[*]     → wildcard — maps over all array elements
 *   data.users[*].id  → wildcard + nested access
 */

export interface ResolveResult {
  ok: true;
  value: unknown;
  isWildcard: boolean;
  totalItems?: number;
}

export interface ResolveError {
  ok: false;
  error: string;
}

/** Parse a path string into segments. */
function parsePath(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  let remaining = path;

  while (remaining.length > 0) {
    if (remaining.startsWith(".")) {
      remaining = remaining.slice(1);
      continue;
    }

    // Bracket notation: [0] or [*]
    const bracketMatch = remaining.match(/^\[(\*|\d+)\]/);
    if (bracketMatch) {
      if (bracketMatch[1] === "*") {
        segments.push({ type: "wildcard" });
      } else {
        segments.push({ type: "index", value: parseInt(bracketMatch[1], 10) });
      }
      remaining = remaining.slice(bracketMatch[0].length);
      continue;
    }

    // Key: everything up to the next dot or bracket
    const keyMatch = remaining.match(/^([^.\[\]]+)/);
    if (keyMatch) {
      segments.push({ type: "key", value: keyMatch[1] });
      remaining = remaining.slice(keyMatch[0].length);
      continue;
    }

    break;
  }

  return segments;
}

type PathSegment =
  | { type: "key"; value: string }
  | { type: "index"; value: number }
  | { type: "wildcard" };

/** Resolve a path against a JSON value. */
export function resolvePath(
  root: unknown,
  path: string,
  maxItems: number = 5,
): ResolveResult | ResolveError {
  const segments = parsePath(path);

  if (segments.length === 0) {
    return { ok: true, value: root, isWildcard: false };
  }

  return resolveSegments(root, segments, 0, maxItems);
}

function resolveSegments(
  current: unknown,
  segments: PathSegment[],
  index: number,
  maxItems: number,
): ResolveResult | ResolveError {
  if (index >= segments.length) {
    return { ok: true, value: current, isWildcard: false };
  }

  const seg = segments[index];

  if (seg.type === "key") {
    if (current === null || current === undefined || typeof current !== "object" || Array.isArray(current)) {
      return { ok: false, error: `Cannot access key "${seg.value}" on ${typeLabel(current)}` };
    }
    const obj = current as Record<string, unknown>;
    if (!(seg.value in obj)) {
      return { ok: false, error: `Key "${seg.value}" not found. Available keys: ${Object.keys(obj).join(", ")}` };
    }
    return resolveSegments(obj[seg.value], segments, index + 1, maxItems);
  }

  if (seg.type === "index") {
    if (!Array.isArray(current)) {
      return { ok: false, error: `Cannot index into ${typeLabel(current)}` };
    }
    if (seg.value < 0 || seg.value >= current.length) {
      return { ok: false, error: `Index ${seg.value} out of bounds (array has ${current.length} items)` };
    }
    return resolveSegments(current[seg.value], segments, index + 1, maxItems);
  }

  if (seg.type === "wildcard") {
    if (!Array.isArray(current)) {
      return { ok: false, error: `Cannot use wildcard [*] on ${typeLabel(current)}` };
    }

    const totalItems = current.length;
    const sampled = current.slice(0, maxItems);
    const results: unknown[] = [];

    for (const item of sampled) {
      const result = resolveSegments(item, segments, index + 1, maxItems);
      if (!result.ok) {
        return result;
      }
      results.push(result.value);
    }

    return { ok: true, value: results, isWildcard: true, totalItems };
  }

  return { ok: false, error: "Invalid path segment" };
}

function typeLabel(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `array(${value.length})`;
  return typeof value;
}
