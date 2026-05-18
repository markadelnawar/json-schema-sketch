/**
 * Infers a compact type-tree from a JSON value.
 * Designed for minimal token usage when shared with AI models.
 *
 * Example output for a typical API response:
 *   data.users: array(25) of {id: number, name: string, email: string}
 *   meta.page: number
 *   meta.total: number
 */

export interface SchemaNode {
  type: "string" | "number" | "boolean" | "null" | "object" | "array" | "union";
  /** For strings: character count of the sample value */
  length?: number;
  /** For objects: child key schemas */
  keys?: Record<string, SchemaNode>;
  /** For arrays: schema of array items */
  items?: SchemaNode;
  /** For arrays: element count */
  count?: number;
  /** For arrays: true when count varies across parent array elements (use query_response to check specific items) */
  varyingSizes?: boolean;
  /** True when this key only appears in some elements of the parent array */
  optional?: boolean;
  /** For unions: possible types */
  variants?: SchemaNode[];
  /** For union variants: how many elements matched this variant */
  variantCount?: number;
}

export interface InferOptions {
  /** Maximum recursion depth. Default: 10 */
  maxDepth?: number;
  /**
   * "sampled" (default) — picks up to 3 elements (first, middle, last) for deep inference. Fast, good for uniform API responses.
   * "exhaustive" — infers every element. Catches mixed-type arrays and rare keys that sampling would miss.
   */
  mode?: "sampled" | "exhaustive";
}

export interface RenderOptions {
  /** Show string character lengths, e.g. string(21) vs string. Default: false */
  showStringLengths?: boolean;
}
