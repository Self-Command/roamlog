/**
 * Place-data attribution — the single source of truth for every surface that
 * shows third-party place data.
 *
 * Geoapify and Photon both serve OpenStreetMap-derived data, so the OSM credit
 * is never optional once results are rendered. Geoapify additionally requires
 * its own "Powered by Geoapify" credit; dropping it in favour of OSM alone
 * would breach the provider terms. Manually typed places have no third-party
 * source, so they must not borrow either credit.
 */
export type PlacesProvider = "geoapify" | "photon" | "local" | null;

export interface PlacesAttributionCopy {
  /** Full credit for roomy surfaces and for assistive technology. */
  text: string;
  /** Link target for the credit, or `null` when the source has no link. */
  href: string | null;
  /** Compact variant for narrow (mobile) surfaces. */
  short: string;
}

export const OSM_ATTRIBUTION_TEXT = "© OpenStreetMap contributors";
export const OSM_ATTRIBUTION_HREF = "https://www.openstreetmap.org/copyright";

const GEOAPIFY_ATTRIBUTION_HREF = "https://www.geoapify.com/";
const PHOTON_ATTRIBUTION_HREF = "https://photon.komoot.io/";
const OSM_SHORT = "© OSM contributors";
const LOCAL_ATTRIBUTION_TEXT = "手动录入";

export function placesAttribution(provider: PlacesProvider): PlacesAttributionCopy {
  switch (provider) {
    case "geoapify":
      return {
        text: `Powered by Geoapify · ${OSM_ATTRIBUTION_TEXT}`,
        href: GEOAPIFY_ATTRIBUTION_HREF,
        short: `Geoapify · ${OSM_SHORT}`,
      };
    case "photon":
      return {
        text: `Search by Photon · ${OSM_ATTRIBUTION_TEXT}`,
        href: PHOTON_ATTRIBUTION_HREF,
        short: `Photon · ${OSM_SHORT}`,
      };
    case "local":
      // Manual entry never leaves the workspace, so it carries no third-party credit.
      return { text: LOCAL_ATTRIBUTION_TEXT, href: null, short: LOCAL_ATTRIBUTION_TEXT };
    case null:
    default:
      // Unknown or map-only surfaces still render OSM tiles/data; stay conservative.
      return {
        text: OSM_ATTRIBUTION_TEXT,
        href: OSM_ATTRIBUTION_HREF,
        short: OSM_SHORT,
      };
  }
}