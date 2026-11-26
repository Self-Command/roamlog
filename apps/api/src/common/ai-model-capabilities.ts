import {
  AI_REASONING_EFFORTS,
  type AiReasoningEffort,
  type ProviderModelCapabilities,
} from "@roamlog/contracts";

import { MODELS_DEV_REASONING } from "./data/models-dev-reasoning.generated.js";

const EFFORT_SET = new Set<string>(AI_REASONING_EFFORTS);
const EFFECTIVE_EFFORT_RANK = new Map<AiReasoningEffort, number>(
  AI_REASONING_EFFORTS.map((effort, index) => [effort, index]),
);

function normalize(value: string): string {
  return value.trim().toLowerCase().replaceAll("_", "-");
}

function bareModelId(modelId: string): string {
  const normalized = normalize(modelId);
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

function sortEfforts(values: Iterable<string>): AiReasoningEffort[] {
  const unique = new Set<AiReasoningEffort>();
  for (const value of values) {
    if (EFFORT_SET.has(value)) unique.add(value as AiReasoningEffort);
  }
  return [...unique].sort(
    (left, right) =>
      (EFFECTIVE_EFFORT_RANK.get(left) ?? 0) - (EFFECTIVE_EFFORT_RANK.get(right) ?? 0),
  );
}

function exactLookup(modelId: string, provider: string | null | undefined): readonly string[] {
  const normalizedModel = normalize(modelId);
  const bare = bareModelId(modelId);
  const providerKey = provider?.trim() ? `${normalize(provider)}/${bare}` : null;

  return (
    (providerKey ? MODELS_DEV_REASONING.byProviderModel[providerKey] : undefined) ??
    MODELS_DEV_REASONING.byCanonical[normalizedModel] ??
    (normalizedModel.includes("/")
      ? MODELS_DEV_REASONING.byProviderModel[normalizedModel]
      : undefined) ??
    MODELS_DEV_REASONING.byBare[bare] ??
    []
  );
}

function fuzzyLookup(modelId: string): readonly string[] {
  const bare = bareModelId(modelId);
  if (bare.length < 4) return [];

  const signatures = new Map<string, { readonly values: AiReasoningEffort[]; count: number }>();
  const add = (key: string, values: readonly string[]): void => {
    const normalizedKey = normalize(key);
    if (
      normalizedKey !== bare &&
      !normalizedKey.endsWith(`/${bare}`) &&
      !normalizedKey.startsWith(`${bare}-`) &&
      !bare.startsWith(`${normalizedKey}-`)
    ) {
      return;
    }
    const sorted = sortEfforts(values);
    if (sorted.length === 0) return;
    const signature = sorted.join("|");
    const existing = signatures.get(signature);
    signatures.set(signature, {
      values: sorted,
      count: (existing?.count ?? 0) + 1,
    });
  };

  for (const [key, values] of Object.entries(MODELS_DEV_REASONING.byCanonical)) {
    add(key, values);
  }
  for (const [key, values] of Object.entries(MODELS_DEV_REASONING.byBare)) {
    add(key, values);
  }

  if (signatures.size === 0) return [];

  // Gateway aliases such as `auto/deepseek-v4.1-flash` often match several
  // provider-specific rows with different subsets. Returning [] would hide the
  // selector entirely; choose the most frequently observed models.dev signature
  // instead. Tiers still come only from the catalog snapshot — nothing is
  // invented for the alias.
  return [...signatures.values()].sort((left, right) => {
    if (left.count !== right.count) return right.count - left.count;
    if (left.values.length !== right.values.length) {
      return right.values.length - left.values.length;
    }
    return (
      (EFFECTIVE_EFFORT_RANK.get(right.values[right.values.length - 1]!) ?? 0) -
      (EFFECTIVE_EFFORT_RANK.get(left.values[left.values.length - 1]!) ?? 0)
    );
  })[0]!.values;
}

export interface ReasoningCapabilityInput {
  readonly modelId: string;
  readonly provider?: string | null;
  readonly ownedBy?: string | null;
  readonly protocol?: string | null;
  readonly declared?: ProviderModelCapabilities | null;
}

/**
 * The effort tiers a specific model is allowed to receive.
 *
 * Priority:
 * 1. operator-declared capabilities (an explicit override);
 * 2. models.dev's `reasoning_options[type=effort]` snapshot, exact provider/
 *    model or canonical id;
 * 3. a unique fuzzy alias (`deepseek-v4.1-flash` -> `...-1017`);
 * 4. empty — never invent a tier for an unknown model.
 *
 * Anthropic Messages has no effort parameter in this adapter, so it always
 * returns an empty list even if the underlying model family advertises tiers in
 * another protocol.
 */
export function reasoningEffortsForModel(input: ReasoningCapabilityInput): AiReasoningEffort[] {
  if (input.protocol === "anthropic-messages") return [];

  const declared = input.declared;
  if (declared?.reasoningEfforts !== undefined) {
    return sortEfforts(declared.reasoningEfforts);
  }
  if (declared?.reasoning === false) return [];

  const exact = exactLookup(input.modelId, input.provider ?? input.ownedBy);
  if (exact.length > 0) return sortEfforts(exact);

  return sortEfforts(fuzzyLookup(input.modelId));
}

export function defaultReasoningEffortForModel(
  declared: ProviderModelCapabilities | null | undefined,
): AiReasoningEffort | undefined {
  return declared?.defaultReasoningEffort;
}

/**
 * Merge the catalog capability with any vision/tools declaration the operator
 * already stored. Used when discovery persists a model row.
 */
export function reasoningCapabilitiesForModel(
  input: ReasoningCapabilityInput,
): ProviderModelCapabilities {
  const efforts = reasoningEffortsForModel(input);
  const declared = input.declared ?? {};
  return {
    ...(declared.vision === undefined ? {} : { vision: declared.vision }),
    ...(declared.tools === undefined ? {} : { tools: declared.tools }),
    reasoning: efforts.length > 0,
    ...(efforts.length > 0 ? { reasoningEfforts: efforts } : {}),
    ...(declared.defaultReasoningEffort
      ? { defaultReasoningEffort: declared.defaultReasoningEffort }
      : {}),
  };
}

export function modelsDevReasoningSource(): {
  readonly source: string;
  readonly commit: string;
  readonly license: string;
} {
  return {
    source: MODELS_DEV_REASONING.source,
    commit: MODELS_DEV_REASONING.commit,
    license: MODELS_DEV_REASONING.license,
  };
}
