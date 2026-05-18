<p align="center">
  <img src="https://raw.githubusercontent.com/markadelnawar/json-schema-sketch/main/images/banner_1.png" alt="json-schema-sketch" width="100%" />
</p>

# json-schema-sketch

Infer compact schema descriptions from any JSON value. Produces a text representation of the data's structure — types, array counts, optional keys, unions — without the actual values.

```typescript
import { inferSchema, renderSchema } from "json-schema-sketch";

const apiResponse = {
  data: [
    { id: 1, name: "Alice", email: "alice@test.com", tags: ["admin", "user"] },
    { id: 2, name: "Bob", email: "bob@test.com", tags: ["user"] },
    { id: 3, name: "Charlie", tags: ["user", "beta"] },
  ],
  meta: { page: 1, total: 200, per_page: 25 },
};

console.log(renderSchema(inferSchema(apiResponse)));
```

```
data: array(3) of {id: number, name: string, email: (optional) string, tags: array(varying sizes) of string}
meta: {page: number, total: number, per_page: number}
```

The output tells you `email` only appears on some elements, `tags` has different lengths across elements, and there are 3 items — without including any values.

## Install

```bash
npm install json-schema-sketch
```

Zero dependencies. ESM only. Node 18+.

## Use cases

### LLM tool-use context

When an LLM calls a tool that returns JSON, you can send the schema instead of the full payload to reduce token usage:

```typescript
const response = await fetch("/api/products");
const data = await response.json();
const schema = renderSchema(inferSchema(data));
// Pass `schema` to the LLM instead of `data`
```

### Schema-first data exploration

Infer the shape first, then use `resolvePath` to extract specific values:

```typescript
import { inferSchema, renderSchema, resolvePath } from "json-schema-sketch";

// See the structure
renderSchema(inferSchema(data));
// → data.users: array(200) of {id: number, name: string, email: string}

// Extract what you need
const result = resolvePath(data, "data.users[*].email", 5);
// → { ok: true, value: ["alice@test.com", "bob@test.com", ...], totalItems: 200 }
```

`maxItems` caps the wildcard output so you don't dump 200 values into context.

### Path resolution with error feedback

`resolvePath` returns structured errors that include available keys, so an LLM can self-correct:

```typescript
resolvePath(data, "data.users[0].emial");
// → { ok: false, error: 'Key "emial" not found. Available keys: id, name, email' }

resolvePath(data, "data.users[999]");
// → { ok: false, error: 'Index 999 out of bounds (array has 3 items)' }

resolvePath(data, "data.users.name");
// → { ok: false, error: 'Cannot access key "name" on array(3)' }
```

### Database query inspection

```typescript
const rows = await db.query("SELECT * FROM orders LIMIT 100");
console.log(renderSchema(inferSchema(rows)));
// → array(100) of {id: number, user_id: number, total: number, status: string, created_at: string}
```

### API documentation from samples

Infer a schema from an actual response when no OpenAPI spec exists:

```typescript
const response = await fetch("https://api.example.com/v1/products");
const data = await response.json();
console.log(renderSchema(inferSchema(data, { mode: "exhaustive" })));
```

## API

### `inferSchema(value, options?): SchemaNode`

Infers a schema tree from any JSON value.

```typescript
inferSchema(data);
inferSchema(data, { mode: "exhaustive" });
inferSchema(data, { mode: "sampled", maxDepth: 5 });
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mode` | `"sampled" \| "exhaustive"` | `"sampled"` | `sampled` picks 3 elements (first, middle, last). `exhaustive` checks every element. |
| `maxDepth` | `number` | `10` | Maximum recursion depth. Objects beyond this depth return as opaque `{}`. |

- `sampled` — skips most array elements. Suitable when elements are uniform (typical API responses).
- `exhaustive` — infers every element. Use when elements may have different types or different keys.

### `renderSchema(node, options?): string`

Renders a `SchemaNode` tree as compact text.

```typescript
renderSchema(schema);
renderSchema(schema, { showStringLengths: true });
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `showStringLengths` | `boolean` | `false` | Show character counts: `string(21)` instead of `string` |

### `resolvePath(root, path, maxItems?): ResolveResult | ResolveError`

Resolves a dot/bracket path against a JSON value. Returns a discriminated union on `ok`.

```typescript
resolvePath(data, "users[0].name");        // single value
resolvePath(data, "users[*].name");        // wildcard — all names
resolvePath(data, "users[*].name", 3);     // wildcard — first 3 only
```

| Syntax | Description |
|--------|-------------|
| `data.users` | Object key access |
| `data.users[0]` | Array index |
| `data.users[*]` | Wildcard (all elements, capped at `maxItems`) |
| `data.users[*].id` | Wildcard + nested access |

## Output format reference

The output is not JSON Schema. It's a compact text notation:

```
data.users: array(200) of {id: number, name: string, email: (optional) string}
data.users.tags: array(varying sizes) of string
meta: {page: number, total: number}
```

| Feature | Notation | Meaning |
|---------|----------|---------|
| Array with count | `array(25) of string` | 25-element array of strings |
| Inline object | `{id: number, name: string}` | Object rendered on one line (< 80 chars) |
| Dot-path expansion | `product.name: string` | Object too wide for inline, keys listed individually |
| Optional key | `(optional) string` | Key absent from some array elements |
| Varying sizes | `array(varying sizes) of string` | Nested arrays differ in length across elements |
| Union types | `string \| number` | Value can be either type |
| Variant counts | `{id: number}(×4) \| string` | 4 elements were objects, 1 was a string |
| String lengths | `string(21)` | Character count (opt-in via `showStringLengths`) |
| Empty containers | `array(0) empty` / `{}` | Empty array or object |

## LLM compatibility

We pasted the raw output into Claude and ChatGPT without any context about the format. Both parsed it correctly.

<details>
<summary><strong>Claude's interpretation</strong></summary>

**Prompt:**

> what does this text mean?
> ```
> array(4) of {id: number, value: string(×3) | {nested: boolean, deep: string}}
> ```

**Response:**

> - `array(4)` means it's an array containing 4 elements.
> - Each element is an object with two properties:
>   - `id` — a number
>   - `value` — this can be one of two things (that's what the `|` means):
>     - a string, and the `(×3)` indicates this string variant occurs in 3 of the 4 elements, or
>     - a nested object containing `nested` (boolean) and `deep` (string)
>
> A rough example of what the actual data might look like:
> ```json
> [
>   { "id": 1, "value": "hello" },
>   { "id": 2, "value": "world" },
>   { "id": 3, "value": "foo" },
>   { "id": 4, "value": { "nested": true, "deep": "extra info" } }
> ]
> ```

</details>

<details>
<summary><strong>ChatGPT's interpretation</strong></summary>

**Prompt:**

> what does this text means?
> ```
> array(4) of {id: number, value: string(×3) | {nested: boolean, deep: string}}
> ```

**Response:**

> An array containing exactly 4 items where each item is an object with:
> - `id` → a number
> - `value` → either a string, or an object like `{ nested: boolean, deep: string }`
>
> The `string(×3)` part usually means there are 3 possible string values (or 3 string entries/examples), depending on the tool generating this notation.
>
> In TypeScript-ish form, it would resemble:
> ```typescript
> type Item = {
>   id: number;
>   value: string | { nested: boolean; deep: string };
> };
> type Data = [Item, Item, Item, Item];
> ```

</details>

<details>
<summary><strong>Complex schema — both LLMs</strong></summary>

**Prompt (given to both):**

> what about this?
> ```
> facets: array(8) of {
>   code: string
>   name: string
>   type: string
>   data: array(varying sizes) of {name: string, code: string, count: number,
>     title: string, description: string, id_category: number,
>     children: array(varying sizes) of {id_category: number, code: string,
>     children: array(0), count: number, name: string}}(×4)
>     | {max: number, min: number, 1.0: number, 5.0: number, lat: number,
>     lng: number, city: string}(×3) | string
> }
> ```

**Claude:** Identified 8 facets with polymorphic `data` — arrays of category objects (×4), numeric/geo objects (×3), or plain strings. Noted the recursive `children` structure.

**ChatGPT:** Same structural breakdown. Additionally generated TypeScript type definitions:

```typescript
type CategoryData = {
  name: string; code: string; count: number;
  title: string; description: string; id_category: number;
  children: Child[];
};
type GeoData = {
  max: number; min: number;
  "1.0": number; "5.0": number;
  lat: number; lng: number; city: string;
};
type Facet = {
  code: string; name: string; type: string;
  data: (CategoryData | GeoData | string)[];
};
```

Neither was told what the format is or what tool produced it.

</details>

## License

MIT

<p align="center">
  <img src="https://raw.githubusercontent.com/markadelnawar/json-schema-sketch/main/images/banner_footer.png" alt="json-schema-sketch" width="100%" />
</p>
