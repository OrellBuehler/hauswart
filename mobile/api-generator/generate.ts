/**
 * Turns the OpenAPI document into the Kotlin client of the mobile apps
 * (`mobile/shared/.../api/generated`). Run with `bun run mobile:api`; a test fails when the
 * committed files are stale.
 *
 * Rules: enums are plain strings (a newer server may send a value this build does not know), a
 * union whose alternatives share a constant property becomes a sealed class with an `Unknown`
 * fallback, every other union is a `JsonElement`. Endpoints a bearer token cannot call are left
 * out, as are multipart uploads (written by hand in `ApiHttp`).
 */

export interface Schema {
  $ref?: string;
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  format?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  anyOf?: Schema[];
  oneOf?: Schema[];
  additionalProperties?: Schema | boolean;
}

interface Parameter {
  name: string;
  in: "path" | "query";
  required?: boolean;
  schema: Schema;
}

interface Operation {
  operationId: string;
  summary?: string;
  description?: string;
  tags?: string[];
  security?: Record<string, string[]>[];
  parameters?: Parameter[];
  requestBody?: { content: Record<string, { schema: Schema }> };
  responses: Record<string, { content?: Record<string, { schema: Schema }> }>;
}

export interface OpenApiDoc {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema> };
}

type KType =
  | { k: "prim"; name: "String" | "Long" | "Double" | "Boolean" }
  | { k: "json"; name: "JsonElement" | "JsonObject" }
  | { k: "class"; name: string }
  | { k: "list"; elem: Typed }
  | { k: "map"; value: Typed };

interface Typed {
  type: KType;
  nullable: boolean;
}

const PACKAGE = "ch.orellbuehler.hauswart.api.generated";

const KEYWORDS = new Set([
  "as",
  "break",
  "class",
  "continue",
  "do",
  "else",
  "false",
  "for",
  "fun",
  "if",
  "in",
  "interface",
  "is",
  "null",
  "object",
  "package",
  "return",
  "super",
  "this",
  "throw",
  "true",
  "try",
  "typealias",
  "typeof",
  "val",
  "var",
  "when",
  "while",
]);

function words(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w.length > 0);
}

function pascal(value: string): string {
  const out = words(value)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");
  return /^[0-9]/.test(out) ? `V${out}` : out;
}

function camel(value: string): string {
  const p = pascal(value);
  return p[0].toLowerCase() + p.slice(1);
}

function upperSnake(value: string): string {
  return words(value)
    .map((w) => w.toUpperCase())
    .join("_");
}

function ident(name: string): string {
  const clean = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : camel(name);
  return KEYWORDS.has(clean) ? `\`${clean}\`` : clean;
}

function kotlinString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$")}"`;
}

function comment(text: string): string {
  return text.replace(/\*\//g, "*​/").replace(/\/\*/g, "/​*");
}

function render(t: Typed): string {
  const q = t.nullable ? "?" : "";
  switch (t.type.k) {
    case "prim":
    case "json":
    case "class":
      return t.type.name + q;
    case "list":
      return `List<${render(t.type.elem)}>${q}`;
    case "map":
      return `Map<String, ${render(t.type.value)}>${q}`;
  }
}

function serializer(t: Typed): string {
  const base = ((): string => {
    switch (t.type.k) {
      case "prim":
      case "json":
      case "class":
        return `${t.type.name}.serializer()`;
      case "list":
        return `ListSerializer(${serializer(t.type.elem)})`;
      case "map":
        return `MapSerializer(String.serializer(), ${serializer(t.type.value)})`;
    }
  })();
  return t.nullable ? `${base}.nullable` : base;
}

export function generateMobileApi(doc: OpenApiDoc): Map<string, string> {
  const components = doc.components.schemas;
  const usedNames = new Set(Object.keys(components));
  const sealedNames: string[] = [];

  function refName(s: Schema): string | undefined {
    return s.$ref?.replace("#/components/schemas/", "");
  }

  function unwrapNull(s: Schema): { schema: Schema; nullable: boolean } {
    if (Array.isArray(s.type) && s.type.includes("null")) {
      const rest = s.type.filter((t) => t !== "null");
      return {
        schema: { ...s, type: rest.length === 1 ? rest[0] : rest },
        nullable: true,
      };
    }
    const key = s.anyOf ? "anyOf" : s.oneOf ? "oneOf" : undefined;
    if (key) {
      const alts = s[key] ?? [];
      const rest = alts.filter((a) => a.type !== "null");
      if (rest.length < alts.length) {
        const inner = rest.length === 1 ? rest[0] : { [key]: rest };
        const unwrapped = unwrapNull(inner);
        return { schema: unwrapped.schema, nullable: true };
      }
    }
    return { schema: s, nullable: false };
  }

  function signature(s: Schema, seen: readonly string[] = []): string {
    const { schema, nullable } = unwrapNull(s);
    const n = nullable ? "?" : "";
    const name = refName(schema);
    if (name) {
      if (seen.includes(name)) return `ref:${name}${n}`;
      return signature(components[name], [...seen, name]) + n;
    }
    const alts = schema.oneOf ?? schema.anyOf;
    if (alts)
      return `union(${alts
        .map((a) => signature(a, seen))
        .sort()
        .join("|")})${n}`;
    if (Array.isArray(schema.type) || schema.type === undefined)
      return `json${n}`;
    if (schema.type === "object") {
      const props = schema.properties;
      if (!props) {
        const ap = schema.additionalProperties;
        return `map(${typeof ap === "object" ? signature(ap, seen) : "json"})${n}`;
      }
      return `{${Object.keys(props)
        .sort()
        .map((k) => `${k}:${signature(props[k], seen)}`)
        .join(",")}}${n}`;
    }
    if (schema.type === "array")
      return `[${schema.items ? signature(schema.items, seen) : "json"}]${n}`;
    if (schema.const !== undefined) return `const:${String(schema.const)}${n}`;
    return `${schema.type}${n}`;
  }

  const inlineBySignature = new Map<string, string>();
  const componentBySignature = new Map<string, string>();
  for (const [name, schema] of Object.entries(components)) {
    const s = signature(schema, [name]);
    if (!componentBySignature.has(s)) componentBySignature.set(s, name);
  }

  function uniqueName(suggested: string): string {
    let name = suggested;
    for (let i = 2; usedNames.has(name); i++) name = `${suggested}${i}`;
    usedNames.add(name);
    return name;
  }

  function resolved(s: Schema): Schema {
    const name = refName(s);
    return name ? components[name] : s;
  }

  function discriminatorOf(alts: Schema[]): string | undefined {
    if (alts.length < 2 || alts.some((a) => refName(a))) return undefined;
    const constProps = alts.map((a) =>
      Object.entries(a.properties ?? {})
        .filter(([, v]) => typeof v.const === "string")
        .map(([k]) => k),
    );
    const shared = constProps[0].filter((k) =>
      constProps.every((list) => list.includes(k)),
    );
    const key = shared.includes("type")
      ? "type"
      : shared.includes("kind")
        ? "kind"
        : shared[0];
    if (!key) return undefined;
    const values = alts.map((a) => String(a.properties?.[key].const));
    return new Set(values.map(pascal)).size === values.length ? key : undefined;
  }

  interface Sink {
    blocks: string[];
  }

  function typeOf(
    s: Schema,
    suggest: string,
    patch: boolean,
    sink: Sink,
  ): Typed {
    const { schema, nullable } = unwrapNull(s);
    const name = refName(schema);
    if (name) return { type: { k: "class", name }, nullable };
    const alts = schema.oneOf ?? schema.anyOf;
    const isObject =
      schema.type === "object" &&
      schema.properties !== undefined &&
      Object.keys(schema.properties).length > 0;
    const inlineKey = `${String(patch)}:${signature(schema)}`;
    const distinctive =
      alts !== undefined || Object.keys(schema.properties ?? {}).length >= 3;
    if (distinctive) {
      const match =
        componentBySignature.get(signature(schema)) ??
        inlineBySignature.get(inlineKey);
      if (match) return { type: { k: "class", name: match }, nullable };
    }
    if (alts) {
      const discriminator = discriminatorOf(alts);
      if (!discriminator)
        return { type: { k: "json", name: "JsonElement" }, nullable };
      const className = uniqueName(suggest);
      inlineBySignature.set(inlineKey, className);
      sink.blocks.push(
        sealedClass(className, alts, discriminator, patch, sink),
      );
      return { type: { k: "class", name: className }, nullable };
    }
    if (isObject) {
      const className = uniqueName(suggest);
      inlineBySignature.set(inlineKey, className);
      sink.blocks.push(
        dataClass(className, schema, { patch, sink, indent: "" }),
      );
      return { type: { k: "class", name: className }, nullable };
    }
    if (schema.type === "object") {
      const ap = schema.additionalProperties;
      if (typeof ap === "object" && Object.keys(ap).length > 0)
        return {
          type: { k: "map", value: typeOf(ap, `${suggest}Value`, patch, sink) },
          nullable,
        };
      return { type: { k: "json", name: "JsonObject" }, nullable };
    }
    if (schema.type === "array")
      return {
        type: {
          k: "list",
          elem: schema.items
            ? typeOf(schema.items, `${suggest}Item`, patch, sink)
            : { type: { k: "json", name: "JsonElement" }, nullable: false },
        },
        nullable,
      };
    if (schema.type === "string")
      return { type: { k: "prim", name: "String" }, nullable };
    if (schema.type === "integer")
      return { type: { k: "prim", name: "Long" }, nullable };
    if (schema.type === "number")
      return {
        type: {
          k: "prim",
          name: Number.isInteger(schema.const) ? "Long" : "Double",
        },
        nullable,
      };
    if (schema.type === "boolean")
      return { type: { k: "prim", name: "Boolean" }, nullable };
    return { type: { k: "json", name: "JsonElement" }, nullable };
  }

  function literal(value: unknown, type: Typed): string {
    if (typeof value === "string") return kotlinString(value);
    if (type.type.k === "prim" && type.type.name === "Double")
      return Number.isInteger(value) ? `${String(value)}.0` : String(value);
    return String(value);
  }

  function enumValues(s: Schema): string[] | undefined {
    const { schema } = unwrapNull(s);
    const target =
      schema.type === "array" && schema.items ? schema.items : schema;
    const inner = unwrapNull(resolved(target)).schema;
    return inner.enum?.every((v) => typeof v === "string")
      ? (inner.enum as string[])
      : undefined;
  }

  function dataClass(
    name: string,
    schema: Schema,
    opts: {
      patch: boolean;
      sink: Sink;
      indent: string;
      parent?: string;
      discriminator?: string;
      serialName?: string;
      namePrefix?: string;
    },
  ): string {
    const pad = opts.indent;
    const required = new Set(schema.required ?? []);
    const lines: string[] = [];
    const constants: string[] = [];
    const prefix = opts.namePrefix ?? name;
    for (const [key, prop] of Object.entries(schema.properties ?? {})) {
      if (key === opts.discriminator) continue;
      const typed = typeOf(prop, prefix + pascal(key), opts.patch, opts.sink);
      const id = ident(key);
      const serial =
        id.replace(/`/g, "") === key
          ? ""
          : `@SerialName(${kotlinString(key)}) `;
      const values = enumValues(prop);
      const { schema: bare } = unwrapNull(prop);
      const notes: string[] = [];
      if (values) notes.push(values.join(" | "));
      if (bare.format) notes.push(bare.format);
      if (notes.length > 0)
        lines.push(`${pad}    /** ${comment(notes.join("; "))} */`);
      if (values && values.length > 1)
        constants.push(
          `${pad}        val ${upperSnake(key)}_VALUES: List<String> = listOf(${values.map(kotlinString).join(", ")})`,
        );
      let decl: string;
      if (bare.const !== undefined && !typed.nullable) {
        decl = `@EncodeDefault ${serial}val ${id}: ${render(typed)} = ${literal(bare.const, typed)}`;
      } else if (required.has(key)) {
        decl = `${serial}val ${id}: ${render(typed)}`;
      } else if (opts.patch && typed.nullable) {
        decl = `${serial}val ${id}: Patch<${render({ ...typed, nullable: false })}> = Patch.Keep`;
      } else {
        decl = `${serial}val ${id}: ${render({ ...typed, nullable: true })} = null`;
      }
      lines.push(`${pad}    ${decl},`);
    }
    const head: string[] = [`${pad}@Serializable`];
    if (opts.serialName !== undefined)
      head.push(`${pad}@SerialName(${kotlinString(opts.serialName)})`);
    const parent = opts.parent ? ` : ${opts.parent}()` : "";
    if (lines.length === 0) {
      head.push(`${pad}data object ${name}${parent}`);
      return head.join("\n");
    }
    head.push(`${pad}data class ${name}(`, ...lines);
    if (constants.length > 0) {
      head.push(
        `${pad})${parent} {`,
        `${pad}    companion object {`,
        ...constants,
        `${pad}    }`,
        `${pad}}`,
      );
    } else {
      head.push(`${pad})${parent}`);
    }
    return head.join("\n");
  }

  function sealedClass(
    name: string,
    alts: Schema[],
    discriminator: string,
    patch: boolean,
    sink: Sink,
  ): string {
    sealedNames.push(name);
    const out: string[] = ["@Serializable"];
    if (discriminator !== "type")
      out.push(`@JsonClassDiscriminator(${kotlinString(discriminator)})`);
    out.push(`sealed class ${name} {`);
    for (const alt of alts) {
      const value = String(alt.properties?.[discriminator].const);
      out.push(
        dataClass(pascal(value), alt, {
          patch,
          sink,
          indent: "    ",
          parent: name,
          discriminator,
          serialName: value,
          namePrefix: name + pascal(value),
        }),
        "",
      );
    }
    out.push("    @Serializable", `    data object Unknown : ${name}()`, "}");
    return out.join("\n");
  }

  const header = (imports: string[]): string =>
    [
      "// Generated from docs/openapi.json by `bun run mobile:api`. Do not edit.",
      "@file:OptIn(ExperimentalSerializationApi::class)",
      "",
      `package ${PACKAGE}`,
      "",
      ...imports.map((i) => `import ${i}`),
      "",
    ].join("\n");

  const modelImports = [
    "ch.orellbuehler.hauswart.api.Patch",
    "kotlinx.serialization.EncodeDefault",
    "kotlinx.serialization.ExperimentalSerializationApi",
    "kotlinx.serialization.SerialName",
    "kotlinx.serialization.Serializable",
    "kotlinx.serialization.json.JsonClassDiscriminator",
    "kotlinx.serialization.json.JsonElement",
    "kotlinx.serialization.json.JsonObject",
  ];
  const apiImports = [
    "ch.orellbuehler.hauswart.api.ApiHttp",
    "ch.orellbuehler.hauswart.api.BinaryBody",
    ...modelImports,
    "kotlinx.serialization.builtins.ListSerializer",
    "kotlinx.serialization.builtins.MapSerializer",
    "kotlinx.serialization.builtins.nullable",
    "kotlinx.serialization.builtins.serializer",
  ].sort();

  const files = new Map<string, string>();

  const modelSink: Sink = { blocks: [] };
  for (const [name, schema] of Object.entries(components)) {
    const { schema: bare } = unwrapNull(schema);
    const alts = bare.oneOf ?? bare.anyOf;
    const discriminator = alts ? discriminatorOf(alts) : undefined;
    if (alts && discriminator) {
      modelSink.blocks.push(
        sealedClass(name, alts, discriminator, false, modelSink),
      );
    } else if (bare.type === "object" && bare.properties) {
      modelSink.blocks.push(
        dataClass(name, bare, { patch: false, sink: modelSink, indent: "" }),
      );
    } else {
      const typed = typeOf(bare, `${name}Value`, false, modelSink);
      modelSink.blocks.push(`typealias ${name} = ${render(typed)}`);
    }
  }

  interface TagFile {
    tag: string;
    sink: Sink;
    functions: string[];
  }
  const tags = new Map<string, TagFile>();
  const skipped: string[] = [];

  for (const [path, operations] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(operations)) {
      const security = op.security ?? [];
      const bearer =
        security.length === 0 || security.some((s) => "bearerAuth" in s);
      if (!bearer) continue;
      const multipart =
        op.requestBody && !("application/json" in op.requestBody.content);
      if (multipart) {
        skipped.push(op.operationId);
        continue;
      }
      const tag = op.tags?.[0] ?? "misc";
      let file = tags.get(tag);
      if (!file) {
        file = { tag, sink: { blocks: [] }, functions: [] };
        tags.set(tag, file);
      }
      const base = pascal(op.operationId);
      const patch = method === "patch" || method === "put";
      const params: string[] = [];
      const pathParams = (op.parameters ?? []).filter((p) => p.in === "path");
      const queryParams = (op.parameters ?? []).filter((p) => p.in === "query");
      const docLines = [op.summary ?? op.operationId];
      if (op.description) docLines.push("", ...op.description.split("\n"));

      let kotlinPath = kotlinString(path);
      for (const p of pathParams) {
        params.push(`${ident(p.name)}: String`);
        kotlinPath = kotlinPath.replace(
          `{${p.name}}`,
          `\${ApiHttp.segment(${ident(p.name)})}`,
        );
      }

      let bodyArgs = "";
      const bodySchema = op.requestBody?.content["application/json"].schema;
      if (bodySchema) {
        const typed = typeOf(bodySchema, `${base}Request`, patch, file.sink);
        params.push(`body: ${render(typed)}`);
        bodyArgs = `${serializer(typed)}, body, `;
      }

      const queryPairs: string[] = [];
      for (const p of queryParams) {
        const { schema: bare } = unwrapNull(p.schema);
        const values = bare.enum?.map(String);
        const isBool =
          values?.length === 2 &&
          values.includes("true") &&
          values.includes("false");
        const type = isBool
          ? "Boolean"
          : bare.type === "integer"
            ? "Long"
            : bare.type === "number"
              ? "Double"
              : "String";
        if (values && !isBool)
          docLines.push("", `@param ${p.name} ${values.join(" | ")}`);
        params.push(
          p.required
            ? `${ident(p.name)}: ${type}`
            : `${ident(p.name)}: ${type}? = null`,
        );
        queryPairs.push(`${kotlinString(p.name)} to ${ident(p.name)}`);
      }
      const query =
        queryPairs.length > 0
          ? `listOf(${queryPairs.join(", ")})`
          : "emptyList()";

      const success = Object.entries(op.responses).find(([code]) =>
        code.startsWith("2"),
      );
      const content = success?.[1].content;
      const verb = kotlinString(method.toUpperCase());
      let returns: string;
      let call: string;
      if (!content) {
        returns = "";
        call = `http.empty(${verb}, ${kotlinPath}, ${query}${bodyArgs ? `, ${bodyArgs.replace(/, $/, "")}` : ""})`;
      } else if ("application/json" in content) {
        const typed = typeOf(
          content["application/json"].schema,
          `${base}Response`,
          false,
          file.sink,
        );
        returns = `: ${render(typed)}`;
        call = `http.json(${verb}, ${kotlinPath}, ${query}, ${bodyArgs}${serializer(typed)})`;
      } else {
        returns = ": BinaryBody";
        call = `http.binary(${verb}, ${kotlinPath}, ${query})`;
      }
      const signatureLine =
        params.length === 0
          ? `    suspend fun ${op.operationId}()${returns} =`
          : [
              `    suspend fun ${op.operationId}(`,
              ...params.map((p) => `        ${p},`),
              `    )${returns} =`,
            ].join("\n");
      file.functions.push(
        [
          "    /**",
          ...docLines.map((l) => `     * ${comment(l)}`.trimEnd()),
          "     */",
          signatureLine,
          `        ${call}`,
        ].join("\n"),
      );
    }
  }

  files.set(
    "Models.kt",
    `${header(modelImports)}\n${modelSink.blocks.join("\n\n")}\n`,
  );

  const sortedTags = [...tags.values()].sort((a, b) =>
    a.tag.localeCompare(b.tag),
  );
  for (const file of sortedTags) {
    const className = `${pascal(file.tag)}Api`;
    const body = [
      `class ${className} internal constructor(`,
      "    private val http: ApiHttp,",
      ") {",
      file.functions.join("\n\n"),
      "}",
    ].join("\n");
    const models =
      file.sink.blocks.length > 0 ? `\n\n${file.sink.blocks.join("\n\n")}` : "";
    files.set(`${className}.kt`, `${header(apiImports)}\n${body}${models}\n`);
  }

  const root = [
    header([
      "ch.orellbuehler.hauswart.api.ApiHttp",
      "kotlinx.serialization.ExperimentalSerializationApi",
      "kotlinx.serialization.modules.SerializersModule",
    ]),
    "/** Every endpoint a bearer token may call, grouped by tag. Multipart uploads are in [ApiHttp]. */",
    "class HauswartApi internal constructor(",
    "    val http: ApiHttp,",
    ") {",
    ...sortedTags.map(
      (f) =>
        `    val ${camel(f.tag)}: ${pascal(f.tag)}Api = ${pascal(f.tag)}Api(http)`,
    ),
    "}",
    "",
    `/** Left out (multipart): ${skipped.join(", ")}. */`,
    "internal val generatedSerializersModule: SerializersModule =",
    "    SerializersModule {",
    ...sealedNames
      .sort()
      .map(
        (n) =>
          `        polymorphicDefaultDeserializer(${n}::class) { ${n}.Unknown.serializer() }`,
      ),
    "    }",
    "",
  ].join("\n");
  files.set("HauswartApi.kt", root);

  return files;
}
