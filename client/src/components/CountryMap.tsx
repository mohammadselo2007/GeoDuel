import { useId, useMemo } from "react";
import { geoBounds, geoCentroid, geoMercator, geoPath, type GeoProjection } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { feature } from "topojson-client";
import countries110 from "world-atlas/countries-110m.json";
import { COUNTRIES } from "../../../shared/countries";
import { MICRO_COUNTRY_MAP_ID_SET } from "../../../shared/microCountries";
import type { GamePhase, MapMode } from "../../../shared/types";

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 560;
const VIEW_CENTER: [number, number] = [VIEW_WIDTH / 2, VIEW_HEIGHT / 2];

const FIT_EXTENTS: Record<MapMode, [[number, number], [number, number]]> = {
  outline: [
    [86, 54],
    [914, 506]
  ],
  context: [
    [236, 118],
    [764, 442]
  ]
};

const REGULAR_MAX_SCALE: Record<MapMode, number> = {
  outline: 18000,
  context: 8200
};

const MICRO_MIN_SCALE: Record<MapMode, number> = {
  outline: 22000,
  context: 14000
};

const MICRO_MAX_SCALE: Record<MapMode, number> = {
  outline: 150000,
  context: 48000
};

const MICRO_MIN_VISUAL_SIZE: Record<MapMode, number> = {
  outline: 250,
  context: 112
};

const FALLBACK_SCALE: Record<MapMode, number> = {
  outline: 42000,
  context: 26000
};

const TARGET_PADDING: Record<MapMode, number> = {
  outline: 76,
  context: 104
};

type MicroRegionKey =
  | "alps"
  | "pyrenees"
  | "italy"
  | "malta"
  | "riviera"
  | "gulf"
  | "malacca"
  | "maldives"
  | "westAfrica"
  | "gulfOfGuinea"
  | "westernIndianOcean"
  | "caribbean"
  | "bahamas"
  | "centralPacific"
  | "micronesia"
  | "southPacific";

interface MicroRegionView {
  key: MicroRegionKey;
  center: [number, number];
  contextScale: number;
  outlineScale?: number;
  useRegionalOutline?: boolean;
}

interface MicroContextMarker {
  id: string;
  point: [number, number];
  active: boolean;
}

const MICRO_REGION_VIEWS: Record<string, MicroRegionView> = {
  "020": { key: "pyrenees", center: [1.52, 42.51], contextScale: 9000 },
  "438": { key: "alps", center: [9.55, 47.16], contextScale: 9200 },
  "492": { key: "riviera", center: [7.75, 43.8], contextScale: 11000 },
  "674": { key: "italy", center: [12.45, 42.8], contextScale: 6200 },
  "336": { key: "italy", center: [12.45, 42.8], contextScale: 6200 },
  "470": { key: "malta", center: [14.35, 36.2], contextScale: 5200, useRegionalOutline: true },
  "048": { key: "gulf", center: [50.6, 25.5], contextScale: 5200 },
  "634": { key: "gulf", center: [50.6, 25.5], contextScale: 5200 },
  "702": { key: "malacca", center: [103.5, 1.55], contextScale: 6200 },
  "462": { key: "maldives", center: [73.2, 4.2], contextScale: 3000, useRegionalOutline: true },
  "132": { key: "westAfrica", center: [-21.5, 15.7], contextScale: 2600, useRegionalOutline: true },
  "678": { key: "gulfOfGuinea", center: [5.8, 0.8], contextScale: 4300, useRegionalOutline: true },
  "174": { key: "westernIndianOcean", center: [49.5, -12.8], contextScale: 1900, useRegionalOutline: true },
  "480": { key: "westernIndianOcean", center: [49.5, -12.8], contextScale: 1900, useRegionalOutline: true },
  "690": { key: "westernIndianOcean", center: [49.5, -12.8], contextScale: 1900, useRegionalOutline: true },
  "028": { key: "caribbean", center: [-61.9, 14.8], contextScale: 4200, useRegionalOutline: true },
  "052": { key: "caribbean", center: [-61.9, 14.8], contextScale: 4200, useRegionalOutline: true },
  "212": { key: "caribbean", center: [-61.9, 14.8], contextScale: 4200, useRegionalOutline: true },
  "308": { key: "caribbean", center: [-61.9, 14.8], contextScale: 4200, useRegionalOutline: true },
  "659": { key: "caribbean", center: [-61.9, 14.8], contextScale: 4200, useRegionalOutline: true },
  "662": { key: "caribbean", center: [-61.9, 14.8], contextScale: 4200, useRegionalOutline: true },
  "670": { key: "caribbean", center: [-61.9, 14.8], contextScale: 4200, useRegionalOutline: true },
  "780": { key: "caribbean", center: [-61.9, 14.8], contextScale: 4200, useRegionalOutline: true },
  "044": { key: "bahamas", center: [-77.0, 24.2], contextScale: 3200, useRegionalOutline: true },
  "296": { key: "centralPacific", center: [168.5, 2.9], contextScale: 1900, useRegionalOutline: true },
  "520": { key: "centralPacific", center: [168.5, 2.9], contextScale: 1900, useRegionalOutline: true },
  "584": { key: "centralPacific", center: [168.5, 2.9], contextScale: 1900, useRegionalOutline: true },
  "583": { key: "micronesia", center: [146.5, 7.2], contextScale: 1700, useRegionalOutline: true },
  "585": { key: "micronesia", center: [146.5, 7.2], contextScale: 1700, useRegionalOutline: true },
  "798": { key: "southPacific", center: [-178.2, -14.0], contextScale: 1800, useRegionalOutline: true },
  "882": { key: "southPacific", center: [-178.2, -14.0], contextScale: 1800, useRegionalOutline: true },
  "776": { key: "southPacific", center: [-178.2, -14.0], contextScale: 1800, useRegionalOutline: true }
};

const MICRO_REGION_MARKER_IDS: Partial<Record<MicroRegionKey, string[]>> = {
  alps: ["438"],
  pyrenees: ["020"],
  italy: ["336", "674"],
  malta: ["470"],
  riviera: ["492"],
  gulf: ["048", "634"],
  malacca: ["702"],
  maldives: ["462"],
  westAfrica: ["132"],
  gulfOfGuinea: ["678"],
  westernIndianOcean: ["174", "480", "690"],
  caribbean: ["028", "052", "212", "308", "659", "662", "670", "780"],
  bahamas: ["044"],
  centralPacific: ["296", "520", "584"],
  micronesia: ["583", "585"],
  southPacific: ["798", "882", "776"]
};

type CountryFeature = Feature<Geometry, Record<string, unknown>> & {
  id?: string | number;
};

const topology = countries110 as {
  objects: {
    countries: unknown;
  };
};

const worldFeatureCollection = feature(topology as any, topology.objects.countries as any) as unknown as FeatureCollection<
  Geometry,
  Record<string, unknown>
>;

const countries = worldFeatureCollection.features as CountryFeature[];
const allCountries: FeatureCollection<Geometry, Record<string, unknown>> = {
  type: "FeatureCollection",
  features: countries
};

interface CountryMapProps {
  countryId?: string;
  fallbackPoint?: [number, number];
  mode: MapMode;
  phase: GamePhase;
  notice?: string;
  revealName?: string;
}

export function CountryMap({ countryId, fallbackPoint, mode, phase, notice, revealName }: CountryMapProps) {
  const clipId = useId();
  const glowId = useId();
  const targetCountry = useMemo(
    () => countries.find((country) => normalizeCountryId(country.id) === countryId),
    [countryId]
  );

  const mapRender = useMemo(() => {
    const projection = createProjection({ mode, countryId, targetCountry, fallbackPoint });
    const path = geoPath(projection);
    const targetBounds = targetCountry ? path.bounds(targetCountry) : null;
    const targetGeoPoint = fallbackPoint ?? (targetCountry ? geoCentroid(targetCountry) : undefined);
    const targetCenter = targetGeoPoint ? projection(targetGeoPoint) : targetCountry && targetBounds ? boundsCenter(targetBounds) : null;
    const fallbackScreenPoint = fallbackPoint ? projection(fallbackPoint) : null;
    const targetScreenPoint = targetCenter ?? fallbackScreenPoint;
    const microRegion = countryId ? MICRO_REGION_VIEWS[countryId] : undefined;
    const contextMarkers = microRegion ? buildMicroContextMarkers(projection, microRegion.key, countryId, fallbackPoint) : [];
    const isMicroView =
      isKnownMicroCountry(countryId) ||
      Boolean(fallbackPoint) ||
      Boolean(targetCountry && isTinyProjectedTarget(targetBounds));

    return {
      path,
      projection,
      isMicroView,
      targetScreenPoint,
      microRegion,
      contextMarkers
    };
  }, [countryId, fallbackPoint, mode, targetCountry]);

  const { path, isMicroView, targetScreenPoint, microRegion, contextMarkers } = mapRender;
  const targetPath = targetCountry ? path(targetCountry) : undefined;
  const fallbackScreenPoint = !targetCountry ? targetScreenPoint : null;
  const microRingPoint = isMicroView && targetCountry ? targetScreenPoint : null;
  const mapClass = `map-shell ${phase === "reveal" ? "revealing" : ""} ${mode}`;
  const shouldShowContext = mode === "context" || fallbackScreenPoint || (mode === "outline" && microRegion?.useRegionalOutline);

  return (
    <section className={mapClass} aria-label="Country map">
      <svg className="country-map" viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} role="img">
        <defs>
          <clipPath id={clipId}>
            <rect x="0" y="0" width={VIEW_WIDTH} height={VIEW_HEIGHT} rx="28" />
          </clipPath>
          <filter id={glowId} x="-28%" y="-28%" width="156%" height="156%">
            <feDropShadow dx="0" dy="0" stdDeviation="9" floodColor="#4dd4ff" floodOpacity="0.55" />
            <feDropShadow dx="0" dy="10" stdDeviation="12" floodColor="#000000" floodOpacity="0.32" />
          </filter>
          <radialGradient id="map-water-gradient" cx="50%" cy="45%" r="75%">
            <stop offset="0%" stopColor="#18314a" />
            <stop offset="100%" stopColor="#07111f" />
          </radialGradient>
        </defs>

        <rect className="map-water" x="0" y="0" width={VIEW_WIDTH} height={VIEW_HEIGHT} rx="28" />
        <g className="map-grid-lines">
          {Array.from({ length: 9 }).map((_, index) => (
            <line key={`v-${index}`} x1={100 + index * 100} y1="0" x2={100 + index * 100} y2={VIEW_HEIGHT} />
          ))}
          {Array.from({ length: 5 }).map((_, index) => (
            <line key={`h-${index}`} x1="0" y1={92 + index * 92} x2={VIEW_WIDTH} y2={92 + index * 92} />
          ))}
        </g>

        <g clipPath={`url(#${clipId})`}>
          {shouldShowContext &&
            countries.map((country) => {
              const id = normalizeCountryId(country.id);
              const countryPath = path(country);
              if (!countryPath) return null;
              return (
                <path
                  key={id}
                  d={countryPath}
                  className={id === countryId ? "country-shape target" : "country-shape context"}
                  filter={id === countryId ? `url(#${glowId})` : undefined}
                />
              );
            })}

          {contextMarkers.length > 1 && (
            <g className="micro-context-markers" aria-hidden="true">
              {contextMarkers.map((marker) => (
                <circle
                  key={marker.id}
                  cx={marker.point[0]}
                  cy={marker.point[1]}
                  r={marker.active ? 5 : 3.4}
                  className={marker.active ? "active" : undefined}
                />
              ))}
            </g>
          )}

          {microRingPoint && (
            <g className={targetCountry ? "micro-target-ring" : "micro-target-ring fallback"} filter={`url(#${glowId})`}>
              <circle cx={microRingPoint[0]} cy={microRingPoint[1]} r={targetCountry ? 30 : 30} />
              <circle cx={microRingPoint[0]} cy={microRingPoint[1]} r={targetCountry ? 16 : 14} />
              <circle cx={microRingPoint[0]} cy={microRingPoint[1]} r={targetCountry ? 9 : 6} />
            </g>
          )}

          {mode === "outline" && targetPath && (
            <g className="silhouette-group">
              <path d={targetPath} className="country-silhouette-shadow" />
              <path d={targetPath} className="country-silhouette" filter={`url(#${glowId})`} />
            </g>
          )}

          {fallbackScreenPoint && (
            <g className="fallback-locator" filter={`url(#${glowId})`}>
              <circle cx={fallbackScreenPoint[0]} cy={fallbackScreenPoint[1]} r="18" />
              <circle cx={fallbackScreenPoint[0]} cy={fallbackScreenPoint[1]} r="5" />
            </g>
          )}
        </g>

        {!countryId && !fallbackPoint && (
          <text className="map-placeholder" x={VIEW_WIDTH / 2} y={VIEW_HEIGHT / 2}>
            Waiting for mission lock
          </text>
        )}

        {countryId && !targetCountry && !fallbackPoint && (
          <text className="map-placeholder" x={VIEW_WIDTH / 2} y={VIEW_HEIGHT / 2}>
            Map data missing
          </text>
        )}
      </svg>

      <div className="map-hud">
        <span>{microRegion ? "Micro locator" : mode === "outline" ? "Silhouette scan" : "Neighbor scan"}</span>
        <span>{phase === "reveal" ? "Revealing" : "Live"}</span>
      </div>

      {(notice || revealName) && (
        <div className="map-notice">
          {notice}
          {revealName && <strong>{revealName}</strong>}
        </div>
      )}
    </section>
  );
}

function normalizeCountryId(id: string | number | undefined): string {
  return String(id ?? "").padStart(3, "0");
}

function createProjection({
  mode,
  countryId,
  targetCountry,
  fallbackPoint
}: {
  mode: MapMode;
  countryId?: string;
  targetCountry?: CountryFeature;
  fallbackPoint?: [number, number];
}): GeoProjection {
  const projection = geoMercator();

  if (targetCountry) {
    const center = fallbackPoint ?? geoCentroid(targetCountry);
    const shouldUseMicroZoom = isKnownMicroCountry(countryId) || Boolean(fallbackPoint) || hasTinyGeoBounds(targetCountry);
    const microRegion = countryId ? MICRO_REGION_VIEWS[countryId] : undefined;
    const shouldUseRegionalFrame = Boolean(microRegion && (mode === "context" || microRegion.useRegionalOutline));

    if (shouldUseMicroZoom) {
      if (microRegion && shouldUseRegionalFrame) {
        projection
          .center(microRegion.center)
          .scale(mode === "outline" ? microRegion.outlineScale ?? microRegion.contextScale : microRegion.contextScale)
          .translate(VIEW_CENTER);
        return projection;
      }

      projection.center(center).scale(microScale(targetCountry, mode)).translate(VIEW_CENTER);
      shrinkToKeepTargetVisible(projection, targetCountry, mode);
      return projection;
    }

    projection.fitExtent(FIT_EXTENTS[mode], targetCountry);
    if (projection.scale() > REGULAR_MAX_SCALE[mode]) {
      projection.scale(REGULAR_MAX_SCALE[mode]).center(center).translate(VIEW_CENTER);
      shrinkToKeepTargetVisible(projection, targetCountry, mode);
    }
    return projection;
  }

  if (fallbackPoint) {
    return projection.center(fallbackPoint).scale(FALLBACK_SCALE[mode]).translate(VIEW_CENTER);
  }

  return projection.fitExtent(
    [
      [52, 38],
      [VIEW_WIDTH - 52, VIEW_HEIGHT - 38]
    ],
    allCountries
  );
}

function buildMicroContextMarkers(
  projection: GeoProjection,
  regionKey: MicroRegionKey,
  activeCountryId?: string,
  activeFallbackPoint?: [number, number]
): MicroContextMarker[] {
  const markerIds = MICRO_REGION_MARKER_IDS[regionKey] ?? [];
  const markers = markerIds.flatMap((mapId) => {
    const country = COUNTRIES.find((candidate) => candidate.mapId === mapId);
    if (!country?.fallbackPoint) return [];
    const point = projection(country.fallbackPoint);
    if (!point || !isPointInsideMap(point)) return [];
    return [
      {
        id: mapId,
        point,
        active: mapId === activeCountryId
      }
    ];
  });

  if (markers.some((marker) => marker.active) || !activeFallbackPoint) return markers;

  const point = projection(activeFallbackPoint);
  if (!point || !isPointInsideMap(point)) return markers;

  return [
    ...markers,
    {
      id: "active-fallback",
      point,
      active: true
    }
  ];
}

function isPointInsideMap(point: [number, number]): boolean {
  const [x, y] = point;
  return Number.isFinite(x) && Number.isFinite(y) && x >= -40 && x <= VIEW_WIDTH + 40 && y >= -40 && y <= VIEW_HEIGHT + 40;
}

function isKnownMicroCountry(countryId?: string): boolean {
  return Boolean(countryId && MICRO_COUNTRY_MAP_ID_SET.has(countryId));
}

function hasTinyGeoBounds(country: CountryFeature): boolean {
  const [[minLon, minLat], [maxLon, maxLat]] = geoBounds(country);
  const lonSpan = Math.abs(maxLon - minLon);
  const latSpan = Math.abs(maxLat - minLat);
  return Math.max(lonSpan, latSpan) < 1.15;
}

function microScale(country: CountryFeature, mode: MapMode): number {
  const [[minLon, minLat], [maxLon, maxLat]] = geoBounds(country);
  const lonSpan = Math.max(Math.abs(maxLon - minLon), 0.05);
  const latSpan = Math.max(Math.abs(maxLat - minLat), 0.05);
  const largestSpanRadians = (Math.max(lonSpan, latSpan) * Math.PI) / 180;
  const desiredScale = MICRO_MIN_VISUAL_SIZE[mode] / largestSpanRadians;
  return clamp(desiredScale, MICRO_MIN_SCALE[mode], MICRO_MAX_SCALE[mode]);
}

function shrinkToKeepTargetVisible(projection: GeoProjection, targetCountry: CountryFeature, mode: MapMode) {
  const path = geoPath(projection);
  const bounds = path.bounds(targetCountry);
  const [width, height] = boundsSize(bounds);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;

  const padding = TARGET_PADDING[mode];
  const availableWidth = VIEW_WIDTH - padding * 2;
  const availableHeight = VIEW_HEIGHT - padding * 2;
  const shrinkFactor = Math.min(availableWidth / width, availableHeight / height, 1);
  if (shrinkFactor < 1) {
    projection.scale(projection.scale() * shrinkFactor * 0.96);
  }
}

function isTinyProjectedTarget(bounds: [[number, number], [number, number]] | null): boolean {
  if (!bounds) return false;
  const [width, height] = boundsSize(bounds);
  return Math.max(width, height) < 86;
}

function boundsCenter(bounds: [[number, number], [number, number]]): [number, number] {
  return [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2];
}

function boundsSize(bounds: [[number, number], [number, number]]): [number, number] {
  return [bounds[1][0] - bounds[0][0], bounds[1][1] - bounds[0][1]];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
