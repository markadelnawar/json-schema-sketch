import type { SchemaNode, RenderOptions } from "./types.js";

/** Render a SchemaNode tree as compact text for minimal tokens. */
export function renderSchema(node: SchemaNode, options: RenderOptions = {}): string {
  const lines: string[] = [];
  renderNode(node, "", 0, lines, options);
  return lines.join("\n");
}

function renderNode(node: SchemaNode, prefix: string, indent: number, lines: string[], opts: RenderOptions): void {
  const pad = "  ".repeat(indent);
  const optTag = node.optional ? "(optional) " : "";

  switch (node.type) {
    case "string":
      lines.push(`${pad}${prefix}${optTag}${stringLabel(node, opts)}`);
      break;
    case "number":
      lines.push(`${pad}${prefix}${optTag}number`);
      break;
    case "boolean":
      lines.push(`${pad}${prefix}${optTag}boolean`);
      break;
    case "null":
      lines.push(`${pad}${prefix}${optTag}null`);
      break;

    case "array": {
      const arrLabel = optTag + arrayLabel(node);
      if (!node.items) {
        lines.push(`${pad}${prefix}${arrLabel} empty`);
        break;
      }
      if (node.items.type === "object" && node.items.keys) {
        const inner = renderObjectInline(node.items, opts);
        if (inner.length < 120) {
          lines.push(`${pad}${prefix}${arrLabel} of ${inner}`);
        } else {
          lines.push(`${pad}${prefix}${arrLabel} of {`);
          for (const [k, v] of Object.entries(node.items.keys)) {
            renderNode(v, `${k}: `, indent + 1, lines, opts);
          }
          lines.push(`${pad}}`);
        }
      } else {
        const inner = renderTypeInline(node.items, opts);
        lines.push(`${pad}${prefix}${arrLabel} of ${inner}`);
      }
      break;
    }

    case "object": {
      if (!node.keys || Object.keys(node.keys).length === 0) {
        lines.push(`${pad}${prefix}${optTag}{}`);
        break;
      }
      const inline = renderObjectInline(node, opts);
      if (inline.length < 80 && prefix) {
        lines.push(`${pad}${prefix}${optTag}${inline}`);
      } else {
        if (prefix) {
          // Top-level keys get listed individually
          for (const [k, v] of Object.entries(node.keys)) {
            const fullKey = prefix.endsWith(": ")
              ? `${prefix.slice(0, -2)}.${k}: `
              : `${prefix}${k}: `;
            renderNode(v, fullKey, indent, lines, opts);
          }
        } else {
          for (const [k, v] of Object.entries(node.keys)) {
            renderNode(v, `${k}: `, indent, lines, opts);
          }
        }
      }
      break;
    }

    case "union": {
      if (node.variants) {
        const types = node.variants.map((v) => renderVariant(v, opts)).join(" | ");
        lines.push(`${pad}${prefix}${types}`);
      }
      break;
    }
  }
}

function stringLabel(node: SchemaNode, opts: RenderOptions): string {
  if (opts.showStringLengths && node.length !== undefined) {
    return `string(${node.length})`;
  }
  return "string";
}

function arrayLabel(node: SchemaNode): string {
  if (node.varyingSizes) return "array(varying sizes)";
  return `array(${node.count ?? 0})`;
}

/** Render a type as a short inline string (no newlines). */
function renderTypeInline(node: SchemaNode, opts: RenderOptions): string {
  const prefix = node.optional ? "(optional) " : "";
  switch (node.type) {
    case "string":
      return prefix + stringLabel(node, opts);
    case "number":
      return prefix + "number";
    case "boolean":
      return prefix + "boolean";
    case "null":
      return prefix + "null";
    case "array": {
      const label = arrayLabel(node);
      if (!node.items) return prefix + label;
      return `${prefix}${label} of ${renderTypeInline(node.items, opts)}`;
    }
    case "object":
      return prefix + renderObjectInline(node, opts);
    case "union":
      return prefix + (node.variants?.map((v) => renderVariant(v, opts)).join(" | ") ?? "unknown");
    default:
      return "unknown";
  }
}

/** Render a union variant with optional count suffix, e.g. `{id: number}(×3)`. */
function renderVariant(node: SchemaNode, opts: RenderOptions): string {
  const inline = renderTypeInline(node, opts);
  if (node.variantCount !== undefined && node.variantCount > 1) {
    return `${inline}(×${node.variantCount})`;
  }
  return inline;
}

/** Render an object schema as `{key: type, key: type}`. */
function renderObjectInline(node: SchemaNode, opts: RenderOptions): string {
  if (!node.keys || Object.keys(node.keys).length === 0) return "{}";
  const entries = Object.entries(node.keys).map(
    ([k, v]) => `${k}: ${renderTypeInline(v, opts)}`,
  );
  return `{${entries.join(", ")}}`;
}
