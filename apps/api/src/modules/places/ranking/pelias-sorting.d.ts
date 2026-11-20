/**
 * Minimal type surface for `pelias-sorting@2.0.0` (MIT). The package is plain
 * CommonJS (`index.js:1-187`) and ships no declarations.
 */
declare module "pelias-sorting" {
  export interface PeliasSortableResult {
    layer?: string;
    population?: number;
    popularity?: number;
    center_point?: { lat?: number; lon?: number };
    _score?: number;
  }

  export default function peliasSort(
    clean?: Record<string, unknown>,
  ): (result1: PeliasSortableResult, result2: PeliasSortableResult) => number;
}
