/**
 * Minimal type surface for `pelias-model@11.1.0` (MIT), which ships plain
 * CommonJS without TypeScript declarations. Only the members this module uses
 * are declared; every method exists verbatim in
 * `pelias/model@583b91a415b90fa3cfabdcc51604c26098ebe2ab/Document.js`.
 */
declare module "pelias-model" {
  export class Document {
    constructor(source: string, layer: string, sourceId: string | number);

    source: string;
    layer: string;
    source_id: string;
    name: Record<string, string | string[]>;
    parent: Record<string, Array<string | null>>;
    address_parts: Record<string, string | string[]>;
    center_point: { lat?: number; lon?: number };
    category: string[];
    population?: number;
    popularity?: number;
    bounding_box?: string;

    setId(id: string | number): this;
    getId(): string;
    setSource(source: string): this;
    getSource(): string;
    setLayer(layer: string): this;
    getLayer(): string;
    setSourceId(id: string | number): this;
    getSourceId(): string;
    setName(prop: string, value: string): this;
    getName(prop: string): string | undefined;
    hasName(prop: string): boolean;
    addParent(field: string, name: string, id: string, abbr?: string, source?: string): this;
    setAddress(prop: string, value: string): this;
    getAddress(prop: string): string | undefined;
    hasAddress(prop: string): boolean;
    setPopulation(population: number): this;
    getPopulation(): number | undefined;
    setPopularity(popularity: number): this;
    getPopularity(): number | undefined;
    setCentroid(centroid: { lat: number; lon: number }): this;
    getCentroid(): { lat?: number; lon?: number };
    setBoundingBox(value: {
      upperLeft: { lat: number; lon: number };
      lowerRight: { lat: number; lon: number };
    }): this;
    addCategory(value: string): this;
    toESDocument(): unknown;
  }
}
