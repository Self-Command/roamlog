/**
 * OpenAI-compatible function names allow only `[A-Za-z0-9_-]` and at most 64
 * characters. Roamlog's planner uses protocol-stable names such as
 * `places.search`; translate those names only at the provider boundary and
 * translate tool calls back before the planner sees them.
 */
export interface ToolNameCodec {
  toWire(name: string): string;
  toInternal(name: string): string;
}

const MAX_WIRE_NAME_LENGTH = 64;
const INVALID_WIRE_CHARACTER = /[^A-Za-z0-9_-]/g;

function sanitize(name: string): string {
  const value = name.replace(INVALID_WIRE_CHARACTER, "_").slice(0, MAX_WIRE_NAME_LENGTH);
  return value.length > 0 ? value : "tool";
}

export function createToolNameCodec(tools: readonly { readonly name: string }[]): ToolNameCodec {
  const internalToWire = new Map<string, string>();
  const wireToInternal = new Map<string, string>();

  for (const tool of tools) {
    if (internalToWire.has(tool.name)) {
      continue;
    }
    const base = sanitize(tool.name);
    let wire = base;
    let suffix = 2;
    while (wireToInternal.has(wire) && wireToInternal.get(wire) !== tool.name) {
      const marker = `_${suffix}`;
      suffix += 1;
      wire = `${base.slice(0, MAX_WIRE_NAME_LENGTH - marker.length)}${marker}`;
    }
    internalToWire.set(tool.name, wire);
    wireToInternal.set(wire, tool.name);
  }

  return {
    toWire(name) {
      return internalToWire.get(name) ?? sanitize(name);
    },
    toInternal(name) {
      return wireToInternal.get(name) ?? name;
    },
  };
}
