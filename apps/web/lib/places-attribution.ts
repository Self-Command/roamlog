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
export type PlacesProvider = "geoapify" | "photon" | "tencent" | "local" | "map_pin" | null;

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
const TENCENT_ATTRIBUTION_HREF = "https://map.qq.com/";
const MAP_PIN_ATTRIBUTION_TEXT = "地图选点";

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
    case "tencent":
      // Mainland-China search results come from Tencent Maps (normalized from
      // GCJ-02 to WGS-84); the tiles underneath are still OpenStreetMap.
      return {
        text: `搜索服务：腾讯地图 · ${OSM_ATTRIBUTION_TEXT}`,
        href: TENCENT_ATTRIBUTION_HREF,
        short: `腾讯地图 · ${OSM_SHORT}`,
      };
    case "map_pin":
      // The coordinate came from a click on our own tiles, so there is no
      // third-party geocoder to credit — only the map data itself.
      return {
        text: `${MAP_PIN_ATTRIBUTION_TEXT} · ${OSM_ATTRIBUTION_TEXT}`,
        href: OSM_ATTRIBUTION_HREF,
        short: MAP_PIN_ATTRIBUTION_TEXT,
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