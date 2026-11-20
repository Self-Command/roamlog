import type { Accuracy } from "./pelias-document.js";

/**
 * Pelias `accuracy` middleware.
 *
 * Upstream: `pelias/api@561e3e85f79b5388f88451cb1a49000764d29e35/middleware/accuracy.js:38-54`:
 *
 * ```js
 * switch (hit.layer) {
 *   case 'venue':
 *   case 'address':
 *     hit.accuracy = 'point';
 *     break;
 *   default:
 *     hit.accuracy = 'centroid';
 * }
 * ```
 *
 * The switch is reproduced verbatim; `interpolated` exists upstream as a
 * commented-out level and is intentionally not introduced.
 */
export function accuracyForLayer(layer: string): Accuracy {
  switch (layer) {
    case "venue":
    case "address":
      return "point";
    default:
      return "centroid";
  }
}
