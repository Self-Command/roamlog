export interface MapStop {
  id: string;
  city: string;
  country: string;
  countryCode: string;
  lat: number | null;
  lng: number | null;
  startDate: string;
  endDate: string;
  notes?: string;
  order?: number;
}

export interface MapPoint {
  id: string;
  label: string;
  sublabel?: string;
  lat: number;
  lng: number;
}

export interface CitySearchResult {
  id: string;
  name: string;
  region: string | null;
  country: string;
  countryCode: string;
  lat: number;
  lng: number;
}

export function stopToPoint(stop: MapStop): MapPoint | null {
  if (stop.lat === null || stop.lng === null) return null;
  return {
    id: stop.id,
    label: stop.city,
    sublabel: stop.country,
    lat: stop.lat,
    lng: stop.lng,
  };
}

export function routeCoordinates(stops: MapStop[]): Array<[number, number]> {
  return stops
    .filter(
      (stop): stop is MapStop & { lat: number; lng: number } =>
        stop.lat !== null && stop.lng !== null,
    )
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
    .map((stop) => [stop.lng, stop.lat]);
}
