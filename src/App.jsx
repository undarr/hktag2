import React, { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { initGraph, snap, pathfind } from "./fetch";

// --- GLOWING CIRCLE & DYNAMIC BOUNDARY CONFIG ---
const CIRCLE_CENTER_LAT = 22.3749714;
const CIRCLE_CENTER_LON = 114.1391081;
const CIRCLE_RADIUS_METERS = 36711.51;
const BOUNDARY_MARGIN_METERS = 2500.0;
const BASE_SPAN_METERS = CIRCLE_RADIUS_METERS + BOUNDARY_MARGIN_METERS; // 39,211.51m

function calculateDynamicBounds(width, height) {
  const w = width || window.innerWidth || 1;
  const h = height || window.innerHeight || 1;

  let spanNorthSouthMeters;
  let spanEastWestMeters;

  if (w > h) {
    // Landscape: 2500m away from top and bottom; scale east-west by aspect ratio
    spanNorthSouthMeters = BASE_SPAN_METERS;
    spanEastWestMeters = BASE_SPAN_METERS * (w / h);
  } else {
    // Portrait: 2500m away from left and right; scale north-south by inverse aspect ratio
    spanEastWestMeters = BASE_SPAN_METERS;
    spanNorthSouthMeters = BASE_SPAN_METERS * (h / w);
  }

  const dLat = (spanNorthSouthMeters / 6371000.0) * (180 / Math.PI);
  const dLon =
    (spanEastWestMeters /
      (6371000.0 * Math.cos((CIRCLE_CENTER_LAT * Math.PI) / 180))) *
    (180 / Math.PI);

  return [
    [CIRCLE_CENTER_LON - dLon, CIRCLE_CENTER_LAT - dLat], // Southwest [lng, lat]
    [CIRCLE_CENTER_LON + dLon, CIRCLE_CENTER_LAT + dLat], // Northeast [lng, lat]
  ];
}

const SATELLITE_STYLE = {
  version: 8,
  sources: {
    "satellite-tiles": {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: "satellite-layer",
      type: "raster",
      source: "satellite-tiles",
      minzoom: 9,
      maxzoom: 22,
    },
  ],
};

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

const TEAM_COLORS = [
  "#D50000", "#FF5500", "#C87800", "#008828",
  "#5EA800", "#0088D6", "#002BFF", "#5500FF",
  "#FF1464", "#7B3800", "#66002A", "#003866",
];

const DOT_CONFIGS = [
  { id: 0, symbol: "👮", name: "Officer" },
  { id: 1, symbol: "🚔", name: "Cruiser" },
  { id: 2, symbol: "🚁", name: "Chopper" },
  { id: 3, symbol: "🏃", name: "Runner" },
];

const STATE_COLORS = {
  Move: "#2e7d32",
  Ferry: "#0288d1",
  Redirecting: "#ed6c02",
  Stop: "#757575",
};

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000.0;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function createCircleGeoJSON(centerLat, centerLon, radiusMeters, points = 128) {
  const coords = [];
  const km = radiusMeters / 1000.0;
  const dRad = km / 6371.0;
  const cLat = (centerLat * Math.PI) / 180.0;
  const cLon = (centerLon * Math.PI) / 180.0;

  for (let i = 0; i <= points; i++) {
    const bearing = (i * 2 * Math.PI) / points;
    const lat = Math.asin(
      Math.sin(cLat) * Math.cos(dRad) +
        Math.cos(cLat) * Math.sin(dRad) * Math.cos(bearing)
    );
    const lon =
      cLon +
      Math.atan2(
        Math.sin(bearing) * Math.sin(dRad) * Math.cos(cLat),
        Math.cos(dRad) - Math.sin(cLat) * Math.sin(lat)
      );
    coords.push([(lon * 180.0) / Math.PI, (lat * 180.0) / Math.PI]);
  }
  return coords;
}

// Custom WebGL Fog-of-War Layer
function createFogLayer(dotsRef, unitsPlacedRef) {
  return {
    id: "fog-of-war-layer",
    type: "custom",
    renderingMode: "2d",

    onAdd(map, gl) {
      this.map = map;
      this.gl = gl;

      const vertexSource = `
        attribute vec2 a_pos;
        void main() {
          gl_Position = vec4(a_pos, 0.0, 1.0);
        }
      `;

      const fragmentSource = `
        precision highp float;
        uniform vec2 u_resolution;
        uniform vec2 u_centers[4];
        uniform float u_radii[4];
        uniform int u_unit_count;

        float smax(float a, float b, float k) {
          float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
          return mix(a, b, h) + k * h * (1.0 - h);
        }

        void main() {
          vec2 fragCoord = gl_FragCoord.xy;
          fragCoord.y = u_resolution.y - fragCoord.y;

          for (int i = 0; i < 4; i++) {
            if (i >= u_unit_count) break;
            float d = distance(fragCoord, u_centers[i]);
            float rInner = u_radii[i] * (400.0 / 600.0);
            if (d <= rInner) {
              discard;
            }
          }

          float maxVis = 0.0;
          for (int i = 0; i < 4; i++) {
            if (i >= u_unit_count) break;
            float d = distance(fragCoord, u_centers[i]);
            float rInner = u_radii[i] * (400.0 / 600.0);
            float rOuter = u_radii[i];

            if (d < rOuter) {
              float vis = 1.0 - smoothstep(rInner, rOuter, d);
              maxVis = smax(maxVis, vis, 0.08);
            }
          }

          maxVis = clamp(maxVis, 0.0, 1.0);
          float minFog = 0.72 * (1.0 - maxVis);

          if (minFog <= 0.002) {
            discard;
          }

          gl_FragColor = vec4(0.027, 0.054, 0.090, minFog);
        }
      `;

      const createShader = (type, src) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, src);
        gl.compileShader(shader);
        return shader;
      };

      const prog = gl.createProgram();
      gl.attachShader(prog, createShader(gl.VERTEX_SHADER, vertexSource));
      gl.attachShader(prog, createShader(gl.FRAGMENT_SHADER, fragmentSource));
      gl.linkProgram(prog);
      this.program = prog;

      this.aPos = gl.getAttribLocation(prog, "a_pos");
      this.uRes = gl.getUniformLocation(prog, "u_resolution");
      this.uCenters = gl.getUniformLocation(prog, "u_centers[0]");
      this.uRadii = gl.getUniformLocation(prog, "u_radii[0]");
      this.uCount = gl.getUniformLocation(prog, "u_unit_count");

      this.vertexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW
      );
    },

    onRemove(map, gl) {
      if (this.program) {
        gl.deleteProgram(this.program);
        this.program = null;
      }
      if (this.vertexBuffer) {
        gl.deleteBuffer(this.vertexBuffer);
        this.vertexBuffer = null;
      }
    },

    render(gl) {
      gl.useProgram(this.program);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      const map = this.map;
      const canvas = map.getCanvas();
      const width = canvas.width;
      const height = canvas.height;

      gl.uniform2f(this.uRes, width, height);

      if (!unitsPlacedRef.current) {
        gl.uniform1i(this.uCount, 0);
      } else {
        gl.uniform1i(this.uCount, dotsRef.current.length);

        const centers = [];
        const radii = [];
        const dpr = window.devicePixelRatio || 1;
        const zoom = map.getZoom();

        dotsRef.current.forEach((dot) => {
          const pt = map.project([dot.pos[1], dot.pos[0]]);
          centers.push(pt.x * dpr, pt.y * dpr);

          const latRad = dot.pos[0] * (Math.PI / 180);
          const metersPerPx = (40075016.686 * Math.cos(latRad)) / (512 * Math.pow(2, zoom));
          const sightMeters = dot.sight || 600.0;
          const pxRadius = Math.max(3.0 * dpr, (sightMeters / metersPerPx) * dpr);
          radii.push(pxRadius);
        });

        gl.uniform2fv(this.uCenters, new Float32Array(centers));
        gl.uniform1fv(this.uRadii, new Float32Array(radii));
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.enableVertexAttribArray(this.aPos);
      gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
  };
}

export default function App() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const isMapReadyRef = useRef(false);
  const unitsPlacedRef = useRef(false);
  const markersRef = useRef(new Map());
  const destMarkersRef = useRef(new Map());
  const opponentFeaturesRef = useRef([]);

  const selectionOrderRef = useRef(DOT_CONFIGS.map((c) => c.id));

  const [ourTeamColor] = useState(() => TEAM_COLORS[Math.floor(Math.random() * TEAM_COLORS.length)]);
  const ourTeamColorRef = useRef(ourTeamColor);
  ourTeamColorRef.current = ourTeamColor;

  const [isSatellite, setIsSatellite] = useState(true);
  const isSatelliteRef = useRef(true);
  isSatelliteRef.current = isSatellite;

  const [selectedId, setSelectedId] = useState(null);
  const selectedIdRef = useRef(null);

  const [dotsUI, setDotsUI] = useState(
    DOT_CONFIGS.map((cfg) => ({
      id: cfg.id,
      name: cfg.name,
      symbol: cfg.symbol,
      state: "Stop",
      eta: "--",
      timeLeft: "--",
      distLeft: "--",
      speed: 20.0,
      radius: 25,
      sight: 600,
    }))
  );

  const dotsRef = useRef(
    DOT_CONFIGS.map((cfg) => ({
      id: cfg.id,
      name: cfg.name,
      symbol: cfg.symbol,
      pos: [22.3193, 114.1694],
      state: "Stop",
      preRedirectState: null,
      redirectRequestId: 0,
      speed: 20.0,
      radius: 25,
      sight: 600,
      waypoints: [],
      waterFlags: [],
      segIdx: 0,
      nextAllowedClick: 0,
      redirectStart: 0,
      ferryTarget: null,
      distLeft: "--",
    }))
  );

  const updateStackingOrder = () => {
    const order = selectionOrderRef.current;
    order.forEach((id, rank) => {
      const destMarker = destMarkersRef.current.get(id);
      const unitMarker = markersRef.current.get(id);

      const destZ = 10 + rank * 2;
      const unitZ = 10 + rank * 2 + 1;

      if (destMarker) {
        const destEl = destMarker.getElement();
        destEl.style.zIndex = `${destZ}`;
        if (destEl.parentNode) destEl.parentNode.appendChild(destEl);
      }

      if (unitMarker) {
        const unitEl = unitMarker.getElement();
        unitEl.style.zIndex = `${unitZ}`;
        if (unitEl.parentNode) unitEl.parentNode.appendChild(unitEl);
      }
    });
  };

  const syncMapGraphics = () => {
    const map = mapRef.current;
    if (!map || !isMapReadyRef.current) return;

    dotsRef.current.forEach((dot) => {
      const marker = markersRef.current.get(dot.id);
      if (marker) {
        marker.setLngLat([dot.pos[1], dot.pos[0]]);
      }

      const destMarker = destMarkersRef.current.get(dot.id);
      if (destMarker) {
        const hasDest =
          dot.state !== "Stop" &&
          dot.waypoints &&
          dot.waypoints.length > 1 &&
          dot.segIdx < dot.waypoints.length - 1;

        const destEl = destMarker.getElement();
        if (hasDest) {
          const destCoord = dot.waypoints[dot.waypoints.length - 1];
          destMarker.setLngLat([destCoord[1], destCoord[0]]);
          destEl.style.display = "flex";
        } else {
          destEl.style.display = "none";
        }
      }
    });

    const lineFeatures = [];
    const ringFeatures = [];
    const visionFeatures = [];

    dotsRef.current.forEach((dot) => {
      const { waypoints, waterFlags, segIdx, pos, radius } = dot;

      if (waypoints && waypoints.length > 1 && segIdx < waypoints.length - 1) {
        let currentWater = waterFlags[segIdx] === 1;
        let currentCoords = [
          [pos[1], pos[0]],
          [waypoints[segIdx + 1][1], waypoints[segIdx + 1][0]],
        ];

        for (let i = segIdx + 1; i < waypoints.length - 1; i++) {
          const isWater = waterFlags[i] === 1;
          const nextPt = [waypoints[i + 1][1], waypoints[i + 1][0]];

          if (isWater === currentWater) {
            currentCoords.push(nextPt);
          } else {
            lineFeatures.push({
              type: "Feature",
              geometry: {
                type: "LineString",
                coordinates: currentCoords,
              },
              properties: { isWater: currentWater },
            });
            currentWater = isWater;
            currentCoords = [[waypoints[i][1], waypoints[i][0]], nextPt];
          }
        }

        if (currentCoords.length >= 2) {
          lineFeatures.push({
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: currentCoords,
            },
            properties: { isWater: currentWater },
          });
        }

        const dest = waypoints[waypoints.length - 1];
        ringFeatures.push({
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [createCircleGeoJSON(dest[0], dest[1], radius)],
          },
        });
      }

      visionFeatures.push({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [createCircleGeoJSON(pos[0], pos[1], radius)],
        },
      });
    });

    const pathSource = map.getSource("unit-paths");
    if (pathSource) {
      pathSource.setData({ type: "FeatureCollection", features: lineFeatures });
    }

    const ringSource = map.getSource("dest-rings");
    if (ringSource) {
      ringSource.setData({ type: "FeatureCollection", features: ringFeatures });
    }

    const visionSource = map.getSource("vision-circles");
    if (visionSource) {
      visionSource.setData({ type: "FeatureCollection", features: visionFeatures });
    }

    map.triggerRepaint();
  };

  const setupLayers = (map) => {
    if (!map) return;
    const teamColor = ourTeamColorRef.current;
    const ringColor = isSatelliteRef.current ? "#FFE500" : "#000000";

    // 1. Satellite Base Layer
    if (!map.getSource("satellite-tiles")) {
      map.addSource("satellite-tiles", {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        maxzoom: 19,
      });

      map.addLayer({
        id: "satellite-layer",
        type: "raster",
        source: "satellite-tiles",
        minzoom: 9,
        maxzoom: 22,
        layout: {
          visibility: isSatelliteRef.current ? "visible" : "none",
        },
      });
    }

    // 2. Glowing Boundary Circle Layers
    if (!map.getSource("glowing-circle-source")) {
      const circlePolyCoords = createCircleGeoJSON(
        CIRCLE_CENTER_LAT,
        CIRCLE_CENTER_LON,
        CIRCLE_RADIUS_METERS,
        128
      );

      map.addSource("glowing-circle-source", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: {
                type: "Polygon",
                coordinates: [circlePolyCoords],
              },
            },
          ],
        },
      });

      // Layer A: Outer Soft Aura
      map.addLayer({
        id: "glowing-circle-outer",
        type: "line",
        source: "glowing-circle-source",
        paint: {
          "line-color": ringColor,
          "line-width": 18,
          "line-blur": 10,
          "line-opacity": 0.45,
        },
      });

      // Layer B: Mid Glow Aura
      map.addLayer({
        id: "glowing-circle-mid",
        type: "line",
        source: "glowing-circle-source",
        paint: {
          "line-color": ringColor,
          "line-width": 7,
          "line-blur": 3,
          "line-opacity": 0.75,
        },
      });

      // Layer C: Core Crisp Ring
      map.addLayer({
        id: "glowing-circle-core",
        type: "line",
        source: "glowing-circle-source",
        paint: {
          "line-color": ringColor,
          "line-width": 2.5,
          "line-opacity": 1.0,
        },
      });
    }

    // 3. Opponent Units
    if (!map.getSource("opponent-units")) {
      map.addSource("opponent-units", {
        type: "geojson",
        data: { type: "FeatureCollection", features: opponentFeaturesRef.current },
        tolerance: 0,
      });

      map.addLayer({
        id: "opponent-units-layer",
        type: "circle",
        source: "opponent-units",
        paint: {
          "circle-radius": [
            "interpolate",
            ["exponential", 2],
            ["zoom"],
            1, 2,
            10, 5,
            20, 200,
          ],
          "circle-color": ["get", "color"],
          "circle-opacity": 0.25,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": ["get", "color"],
          "circle-stroke-opacity": 0.8,
        },
      });
    }

    // 4. Paths & Vision Rings
    if (!map.getSource("unit-paths")) {
      map.addSource("unit-paths", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        tolerance: 0,
        buffer: 128,
      });

      map.addLayer({
        id: "unit-paths-layer",
        type: "line",
        source: "unit-paths",
        minzoom: 9,
        maxzoom: 24,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            1, 2.5,
            6, 3.5,
            12, 5,
            18, 7,
          ],
          "line-color": [
            "case",
            ["==", ["get", "isWater"], true],
            "rgba(0, 119, 190, 0.85)",
            "rgba(30, 130, 76, 0.85)",
          ],
        },
      });
    }

    if (!map.getSource("dest-rings")) {
      map.addSource("dest-rings", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        tolerance: 0,
      });

      map.addLayer({
        id: "dest-rings-layer",
        type: "line",
        source: "dest-rings",
        minzoom: 9,
        maxzoom: 24,
        paint: {
          "line-color": teamColor,
          "line-width": 2,
          "line-dasharray": [2, 2],
        },
      });
    }

    if (!map.getSource("vision-circles")) {
      map.addSource("vision-circles", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        tolerance: 0,
      });

      map.addLayer({
        id: "vision-circles-fill",
        type: "fill",
        source: "vision-circles",
        minzoom: 9,
        maxzoom: 24,
        paint: {
          "fill-color": teamColor,
          "fill-opacity": 0.22,
        },
      });

      map.addLayer({
        id: "vision-circles-stroke",
        type: "line",
        source: "vision-circles",
        minzoom: 9,
        maxzoom: 24,
        paint: {
          "line-color": teamColor,
          "line-width": 1.5,
        },
      });
    }

    // 5. Fog-of-War Shader Layer
    if (!map.getLayer("fog-of-war-layer")) {
      map.addLayer(createFogLayer(dotsRef, unitsPlacedRef));
    }

    syncMapGraphics();
  };

  useEffect(() => {
    if (!mapContainerRef.current) return;

    const initialBounds = calculateDynamicBounds(
      window.innerWidth,
      window.innerHeight
    );

    const MapConstructor = maplibregl.Map || maplibregl.default?.Map;

    const map = new MapConstructor({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: [CIRCLE_CENTER_LON, CIRCLE_CENTER_LAT],
      zoom: 10.5,
      minZoom: 9,
      maxZoom: 19,
      maxBounds: initialBounds,
      maxBoundsViscosity: 0.0, // Strict bounce back
      attributionControl: false,
    });

    mapRef.current = map;

    // Window Resize Handler to dynamically update strict aspect-ratio bounds
    const handleResize = () => {
      if (!mapRef.current) return;
      const container = mapContainerRef.current;
      const w = container ? container.clientWidth : window.innerWidth;
      const h = container ? container.clientHeight : window.innerHeight;
      const dynamicBounds = calculateDynamicBounds(w, h);
      mapRef.current.setMaxBounds(dynamicBounds);
    };

    window.addEventListener("resize", handleResize);

    map.on("styledata", () => {
      if (map.isStyleLoaded()) {
        setupLayers(map);
      }
    });

    map.on("load", () => {
      isMapReadyRef.current = true;
      setupLayers(map);

      // Fit map so circle and 2500m margin fill the viewport precisely
      map.fitBounds(initialBounds, { padding: 0, duration: 0 });

      dotsRef.current.forEach((dot) => {
        const MarkerClass = maplibregl.Marker || maplibregl.default?.Marker;

        // Destination Marker
        const destEl = document.createElement("div");
        destEl.id = `marker-dest-${dot.id}`;
        destEl.style.fontSize = "24px";
        destEl.style.width = "40px";
        destEl.style.height = "40px";
        destEl.style.display = "none";
        destEl.style.alignItems = "center";
        destEl.style.justifyContent = "center";
        destEl.style.userSelect = "none";
        destEl.style.pointerEvents = "none";
        destEl.style.setProperty("opacity", "0.6", "important");
        destEl.style.filter = "none";

        const destInner = document.createElement("span");
        destInner.className = "dest-emoji-content";
        destInner.innerText = dot.symbol;
        destInner.style.display = "flex";
        destInner.style.alignItems = "center";
        destInner.style.justifyContent = "center";
        destInner.style.setProperty("opacity", "0.6", "important");
        destInner.style.pointerEvents = "none";
        destEl.appendChild(destInner);

        const destMarker = new MarkerClass({ element: destEl, opacity: "0.6" })
          .setLngLat([dot.pos[1], dot.pos[0]])
          .addTo(map);

        if (destMarker.setOpacity) {
          destMarker.setOpacity("0.6");
        }

        destMarkersRef.current.set(dot.id, destMarker);

        // Unit Marker
        const el = document.createElement("div");
        el.id = `marker-unit-${dot.id}`;
        el.innerText = dot.symbol;
        el.style.fontSize = "24px";
        el.style.width = "40px";
        el.style.height = "40px";
        el.style.display = "flex";
        el.style.alignItems = "center";
        el.style.justifyContent = "center";
        el.style.userSelect = "none";
        el.style.pointerEvents = "none";
        el.style.filter = `drop-shadow(0 0 6px ${ourTeamColorRef.current})`;

        const marker = new MarkerClass({ element: el })
          .setLngLat([dot.pos[1], dot.pos[0]])
          .addTo(map);

        markersRef.current.set(dot.id, marker);
      });

      updateStackingOrder();

      initGraph()
        .then(async ({ bbox }) => {
          const playerSnapPromises = dotsRef.current.map(() => {
            const randLat = bbox[0][0] + Math.random() * (bbox[1][0] - bbox[0][0]);
            const randLon = bbox[0][1] + Math.random() * (bbox[1][0] - bbox[0][1]);
            return snap(randLat, randLon);
          });

          const playerSnaps = await Promise.all(playerSnapPromises);
          playerSnaps.forEach((res, i) => {
            dotsRef.current[i].pos = res.pt;
          });
          unitsPlacedRef.current = true;

          const opponentTeamColors = TEAM_COLORS.filter((c) => c !== ourTeamColorRef.current);
          const opponentPromises = [];

          opponentTeamColors.forEach((tColor) => {
            DOT_CONFIGS.forEach((cfg) => {
              const randLat = bbox[0][0] + Math.random() * (bbox[1][0] - bbox[0][0]);
              const randLon = bbox[0][1] + Math.random() * (bbox[1][0] - bbox[0][1]);
              opponentPromises.push(
                snap(randLat, randLon).then((res) => ({
                  pt: res.pt,
                  symbol: cfg.symbol,
                  teamColor: tColor,
                }))
              );
            });
          });

          const opponentUnits = await Promise.all(opponentPromises);
          const features = opponentUnits.map(({ pt, teamColor }) => ({
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [pt[1], pt[0]],
            },
            properties: { color: teamColor },
          }));

          opponentFeaturesRef.current = features;
          const src = map.getSource("opponent-units");
          if (src) {
            src.setData({
              type: "FeatureCollection",
              features,
            });
          }
        })
        .catch((err) => console.error("Init Error:", err));
    });

    return () => {
      window.removeEventListener("resize", handleResize);
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();
      destMarkersRef.current.forEach((m) => m.remove());
      destMarkersRef.current.clear();
      map.remove();
      mapRef.current = null;
      isMapReadyRef.current = false;
      unitsPlacedRef.current = false;
    };
  }, []);

  // 60 FPS Movement Loop
  useEffect(() => {
    let animId;
    let lastTime = performance.now();
    let lastUIUpdate = 0;

    const loop = (now) => {
      const dt = (now - lastTime) / 1000.0;
      lastTime = now;

      dotsRef.current.forEach((dot) => {
        const { state, waypoints } = dot;
        let segIdx = dot.segIdx;

        const isFerryRedirect = state === "Redirecting" && dot.ferryTarget !== null;
        const canMove = state === "Move" || state === "Ferry" || isFerryRedirect;

        if (canMove && waypoints.length > 1 && segIdx < waypoints.length - 1) {
          let distanceToAdvance = dot.speed * dt;

          while (distanceToAdvance > 0 && segIdx < waypoints.length - 1) {
            if (isFerryRedirect && dot.ferryTarget) {
              if (segIdx >= dot.ferryTarget.nodeIdx) {
                dot.pos = waypoints[dot.ferryTarget.nodeIdx];
                distanceToAdvance = 0;
                break;
              }
            }

            const p1 = dot.pos;
            const p2 = waypoints[segIdx + 1];
            const segDist = haversineMeters(p1[0], p1[1], p2[0], p2[1]);

            if (distanceToAdvance < segDist) {
              const t = distanceToAdvance / segDist;
              dot.pos = [p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t];
              distanceToAdvance = 0;
            } else {
              distanceToAdvance -= segDist;
              dot.pos = p2;
              segIdx++;
              dot.segIdx = segIdx;

              if (isFerryRedirect && dot.ferryTarget && segIdx >= dot.ferryTarget.nodeIdx) {
                distanceToAdvance = 0;
                break;
              }
            }
          }

          if (state !== "Redirecting") {
            const isWater = dot.waterFlags[segIdx] === 1;
            dot.state = isWater ? "Ferry" : "Move";
          }

          if (segIdx >= waypoints.length - 1) {
            dot.state = "Stop";
            dot.waypoints = [];
            dot.waterFlags = [];
            dot.segIdx = 0;
            dot.ferryTarget = null;
            dot.preRedirectState = null;
            dot.timeLeft = "--";
            dot.eta = "--";
            dot.distLeft = "--";
          } else {
            let remDist = haversineMeters(dot.pos[0], dot.pos[1], waypoints[segIdx + 1][0], waypoints[segIdx + 1][1]);
            for (let i = segIdx + 1; i < waypoints.length - 1; i++) {
              remDist += haversineMeters(waypoints[i][0], waypoints[i][1], waypoints[i + 1][0], waypoints[i + 1][1]);
            }
            const remSec = remDist / dot.speed;
            dot.timeLeft = remSec.toFixed(1) + "s";
            const etaDate = new Date(Date.now() + remSec * 1000);
            dot.eta = etaDate.toLocaleTimeString([], { hour12: false });
            dot.distLeft = remDist > 1000 ? (remDist / 1000).toFixed(2) + " km" : remDist.toFixed(0) + " m";
          }
        }
      });

      syncMapGraphics();

      if (now - lastUIUpdate > 100) {
        setDotsUI(
          dotsRef.current.map((d) => ({
            id: d.id,
            name: d.name,
            symbol: d.symbol,
            state: d.state,
            eta: d.eta,
            timeLeft: d.timeLeft,
            distLeft: d.distLeft,
            speed: d.speed,
            radius: d.radius,
            sight: d.sight,
          }))
        );
        lastUIUpdate = now;
      }

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Selection styling
  useEffect(() => {
    const color = ourTeamColorRef.current;

    markersRef.current.forEach((marker, id) => {
      const el = marker.getElement();
      if (id === selectedId) {
        el.style.filter = `drop-shadow(0 0 10px ${color}) drop-shadow(0 0 18px ${color}) drop-shadow(0 0 5px ${color})`;
        el.style.fontSize = "32px";
        el.style.width = "50px";
        el.style.height = "50px";
      } else {
        el.style.filter = `drop-shadow(0 0 6px ${color})`;
        el.style.fontSize = "24px";
        el.style.width = "40px";
        el.style.height = "40px";
      }
    });

    destMarkersRef.current.forEach((destMarker, id) => {
      const el = destMarker.getElement();
      el.style.setProperty("opacity", "0.6", "important");
      if (destMarker.setOpacity) {
        destMarker.setOpacity("0.6");
      }
      const inner = el.querySelector(".dest-emoji-content");
      if (inner) {
        inner.style.setProperty("opacity", "0.6", "important");
      }

      if (id === selectedId) {
        el.style.filter = `drop-shadow(0 0 6px ${color})`;
        el.style.fontSize = "32px";
        el.style.width = "50px";
        el.style.height = "50px";
      } else {
        el.style.filter = "none";
        el.style.fontSize = "24px";
        el.style.width = "40px";
        el.style.height = "40px";
      }
    });

    updateStackingOrder();
  }, [selectedId]);

  const handleToggleSelect = (id) => {
    const map = mapRef.current;
    if (!map) return;

    if (selectedIdRef.current === id) {
      selectedIdRef.current = null;
      setSelectedId(null);
    } else {
      selectedIdRef.current = id;
      setSelectedId(id);

      selectionOrderRef.current = [
        ...selectionOrderRef.current.filter((x) => x !== id),
        id,
      ];

      const dot = dotsRef.current[id];
      if (dot) {
        map.panTo([dot.pos[1], dot.pos[0]], { duration: 400 });
      }
    }
  };

  const handleToggleStyle = () => {
    const map = mapRef.current;
    if (!map) return;
    const nextSatellite = !isSatellite;
    setIsSatellite(nextSatellite);
    isSatelliteRef.current = nextSatellite;

    if (map.getLayer("satellite-layer")) {
      map.setLayoutProperty("satellite-layer", "visibility", nextSatellite ? "visible" : "none");
    } else {
      map.setStyle(nextSatellite ? SATELLITE_STYLE : MAP_STYLE);
    }

    const newGlowColor = nextSatellite ? "#FFE500" : "#000000";
    ["glowing-circle-outer", "glowing-circle-mid", "glowing-circle-core"].forEach((layerId) => {
      if (map.getLayer(layerId)) {
        map.setPaintProperty(layerId, "line-color", newGlowColor);
      }
    });
  };

  // Map Click Rerouting
  useEffect(() => {
    if (!mapRef.current) return;

    const onMapClick = async (e) => {
      const activeId = selectedIdRef.current;
      if (activeId === null) return;

      const dot = dotsRef.current[activeId];
      const now = performance.now();

      if (now < dot.nextAllowedClick || dot.state === "Redirecting") return;

      const { lat: clickLat, lng: clickLon } = e.lngLat;
      const curState = dot.state;
      const waypoints = dot.waypoints;
      const flags = dot.waterFlags;
      const curSeg = dot.segIdx;

      dot.preRedirectState = curState;
      dot.redirectRequestId = (dot.redirectRequestId || 0) + 1;
      const reqId = dot.redirectRequestId;

      dot.redirectStart = performance.now();

      if (curState === "Ferry") {
        let bIdx = waypoints.length - 1;
        for (let i = curSeg; i < flags.length; i++) {
          if (flags[i] === 0) {
            bIdx = i;
            break;
          }
        }

        const nodeBCoord = waypoints[bIdx];
        dot.ferryTarget = { nodeIdx: bIdx, coord: nodeBCoord };
        dot.state = "Redirecting";

        const snapC = await snap(clickLat, clickLon);
        const snapB = await snap(nodeBCoord[0], nodeBCoord[1]);
        const { flatPolyline: bToCFlat, waterFlags: bToCFlags } = await pathfind(snapB, snapC);

        if (dot.redirectRequestId !== reqId || dot.state !== "Redirecting") return;

        const bToCWaypoints = [];
        for (let i = 0; i < bToCFlat.length; i += 2) {
          bToCWaypoints.push([bToCFlat[i], bToCFlat[i + 1]]);
        }

        const pointF = dot.pos;
        const currentSegNow = dot.segIdx;

        let remainingToB = [pointF];
        let remainingFlagsToB = [];

        if (currentSegNow < bIdx) {
          for (let i = currentSegNow + 1; i <= bIdx; i++) remainingToB.push(waypoints[i]);
          for (let i = currentSegNow; i < bIdx; i++) remainingFlagsToB.push(flags[i]);
        }

        const newWaypoints = [...remainingToB, ...bToCWaypoints.slice(1)];
        const newFlags = [...remainingFlagsToB, ...Array.from(bToCFlags)];

        dot.waypoints = newWaypoints;
        dot.waterFlags = newFlags;
        dot.segIdx = 0;
        dot.pos = newWaypoints[0];
        dot.ferryTarget = null;
        dot.preRedirectState = null;

        dot.nextAllowedClick = performance.now() + 200;
        dot.state = newFlags[0] === 1 ? "Ferry" : "Move";
      } else {
        dot.state = "Redirecting";

        const startPos = dot.pos;
        const snapC = await snap(clickLat, clickLon);
        const snapStart = await snap(startPos[0], startPos[1]);
        const { flatPolyline, waterFlags } = await pathfind(snapStart, snapC);

        if (dot.redirectRequestId !== reqId || dot.state !== "Redirecting") return;

        const newWaypoints = [];
        for (let i = 0; i < flatPolyline.length; i += 2) {
          newWaypoints.push([flatPolyline[i], flatPolyline[i + 1]]);
        }

        dot.waypoints = newWaypoints;
        dot.waterFlags = Array.from(waterFlags);
        dot.segIdx = 0;
        dot.pos = newWaypoints[0];
        dot.preRedirectState = null;

        dot.nextAllowedClick = performance.now() + 200;
        dot.state = waterFlags[0] === 1 ? "Ferry" : "Move";
      }
    };

    const map = mapRef.current;
    map.on("click", onMapClick);
    return () => map.off("click", onMapClick);
  }, []);

  const handleAddSpeed = (id, e) => {
    e.stopPropagation();
    const dot = dotsRef.current[id];
    if (dot) dot.speed += 5.0;
  };

  const handleAddRadius = (id, e) => {
    e.stopPropagation();
    const dot = dotsRef.current[id];
    if (dot) dot.radius += 10;
  };

  const handleAddSight = (id, e) => {
    e.stopPropagation();
    const dot = dotsRef.current[id];
    if (dot) {
      dot.sight = (dot.sight || 600) + 100;
      syncMapGraphics();
    }
  };

  const handleTeleport = (id, e) => {
    e.stopPropagation();
    const dot = dotsRef.current[id];
    if (!dot || !dot.waypoints || dot.waypoints.length === 0) return;

    const destCoord = dot.waypoints[dot.waypoints.length - 1];
    dot.pos = destCoord;

    dot.waypoints = [];
    dot.waterFlags = [];
    dot.segIdx = 0;
    dot.ferryTarget = null;
    dot.preRedirectState = null;
    dot.state = "Stop";
    dot.timeLeft = "--";
    dot.eta = "--";
    dot.distLeft = "--";
  };

  const handleStop = (id, e) => {
    e.stopPropagation();
    const dot = dotsRef.current[id];
    if (!dot) return;

    dot.redirectRequestId = (dot.redirectRequestId || 0) + 1;

    const currentState = dot.state;
    const effectiveState =
      currentState === "Redirecting" ? dot.preRedirectState || "Move" : currentState;

    if (effectiveState === "Ferry") {
      const waypoints = dot.waypoints;
      const flags = dot.waterFlags;
      const curSeg = dot.segIdx;

      let bIdx = waypoints.length - 1;
      for (let i = curSeg; i < flags.length; i++) {
        if (flags[i] === 0) {
          bIdx = i;
          break;
        }
      }

      if (waypoints.length > 0 && bIdx < waypoints.length) {
        dot.waypoints = waypoints.slice(0, bIdx + 1);
        dot.waterFlags = flags.slice(0, bIdx);
      }

      dot.ferryTarget = null;
      dot.preRedirectState = null;

      if (dot.segIdx >= dot.waypoints.length - 1) {
        dot.state = "Stop";
        dot.waypoints = [];
        dot.waterFlags = [];
        dot.segIdx = 0;
        dot.timeLeft = "--";
        dot.eta = "--";
        dot.distLeft = "--";
      } else {
        dot.state = "Ferry";
      }
    } else {
      dot.state = "Stop";
      dot.waypoints = [];
      dot.waterFlags = [];
      dot.segIdx = 0;
      dot.ferryTarget = null;
      dot.preRedirectState = null;
      dot.timeLeft = "--";
      dot.eta = "--";
      dot.distLeft = "--";
    }

    syncMapGraphics();
  };

  const selectedDotUI = dotsUI.find((d) => d.id === selectedId);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100dvh",
        margin: 0,
        padding: 0,
        overflow: "hidden",
        backgroundColor: "#1a1a1a",
      }}
    >
      <div
        ref={mapContainerRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          zIndex: 1,
        }}
      />

      {/* Top-Left Style Toggle Button */}
      <button
        onClick={handleToggleStyle}
        style={{
          position: "absolute",
          top: "calc(16px + env(safe-area-inset-top, 0px))",
          left: 16,
          zIndex: 40,
          width: "48px",
          height: "48px",
          borderRadius: "50%",
          backgroundColor: "#ffffff",
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.25)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "22px",
          cursor: "pointer",
          border: "none",
          outline: "none",
          userSelect: "none",
          padding: 0,
          transition: "transform 0.15s ease",
        }}
        title={isSatellite ? "Switch to Map" : "Switch to Satellite"}
      >
        {isSatellite ? "🗺️" : "🌍"}
      </button>

      {/* Unit Selection Toolbar */}
      <div
        style={{
          position: "absolute",
          bottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
          left: 16,
          zIndex: 40,
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        {dotsUI.map((dot) => {
          const isSelected = selectedId === dot.id;
          const isMoving = dot.state !== "Stop";
          const borderColor = isMoving ? STATE_COLORS[dot.state] || "#2e7d32" : "transparent";

          return (
            <button
              key={dot.id}
              onClick={() => handleToggleSelect(dot.id)}
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                backgroundColor: isSelected ? "#fff9c4" : "#ffffff",
                border: isMoving ? `2.5px solid ${borderColor}` : "2.5px solid transparent",
                boxShadow: "0 2px 8px rgba(0, 0, 0, 0.25)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "22px",
                cursor: "pointer",
                transition: "background-color 0.2s ease, border-color 0.2s ease",
                outline: "none",
                userSelect: "none",
                padding: 0,
              }}
            >
              {dot.symbol}
            </button>
          );
        })}
      </div>

      {/* Bottom Tactical Drawer */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 76,
          right: 0,
          zIndex: 30,
          backgroundColor: "rgba(255, 255, 255, 0.95)",
          backdropFilter: "blur(8px)",
          boxShadow: "0 -4px 16px rgba(0, 0, 0, 0.15)",
          borderTop: "1.5px solid #e0e0e0",
          borderTopLeftRadius: "16px",
          padding: "12px 18px",
          paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))",
          fontFamily: "system-ui, -apple-system, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "12px",
          transform: selectedDotUI ? "translateY(0)" : "translateY(110%)",
          transition: "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
          pointerEvents: selectedDotUI ? "auto" : "none",
        }}
      >
        {selectedDotUI && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "24px" }}>{selectedDotUI.symbol}</span>
              <div>
                <b style={{ fontSize: "14px", display: "block", color: "#222" }}>
                  {selectedDotUI.name}
                </b>
                <span
                  style={{
                    display: "inline-block",
                    padding: "2px 8px",
                    borderRadius: "10px",
                    fontSize: "10px",
                    fontWeight: "bold",
                    color: "#fff",
                    background: STATE_COLORS[selectedDotUI.state] || "#757575",
                  }}
                >
                  {selectedDotUI.state}
                </span>
              </div>
            </div>

            <div style={{ display: "flex", gap: "14px", alignItems: "center" }}>
              <div style={{ fontSize: "12px", color: "#333" }}>
                <span style={{ fontSize: "10px", color: "#888", display: "block" }}>ETA</span>
                <b>{selectedDotUI.eta}</b>
              </div>
              <div style={{ fontSize: "12px", color: "#333" }}>
                <span style={{ fontSize: "10px", color: "#888", display: "block" }}>Time Left</span>
                <b>{selectedDotUI.timeLeft}</b>
              </div>
              <div style={{ fontSize: "12px", color: "#333" }}>
                <span style={{ fontSize: "10px", color: "#888", display: "block" }}>Distance</span>
                <b>{selectedDotUI.distLeft}</b>
              </div>
              <div style={{ fontSize: "12px", color: "#333" }}>
                <span style={{ fontSize: "10px", color: "#888", display: "block" }}>Speed</span>
                <b>{selectedDotUI.speed} m/s</b>
              </div>
              <div style={{ fontSize: "12px", color: "#333" }}>
                <span style={{ fontSize: "10px", color: "#888", display: "block" }}>Reach</span>
                <b>{selectedDotUI.radius} m</b>
              </div>
              <div style={{ fontSize: "12px", color: "#333" }}>
                <span style={{ fontSize: "10px", color: "#888", display: "block" }}>Sight</span>
                <b>{selectedDotUI.sight} m</b>
              </div>
            </div>

            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <button
                onClick={(e) => handleAddSpeed(selectedDotUI.id, e)}
                style={{
                  padding: "5px 10px",
                  background: "#0d6efd",
                  color: "#fff",
                  border: "none",
                  borderRadius: "14px",
                  fontSize: "11px",
                  fontWeight: "bold",
                  cursor: "pointer",
                }}
              >
                +5ms⁻¹
              </button>
              <button
                onClick={(e) => handleAddRadius(selectedDotUI.id, e)}
                style={{
                  padding: "5px 10px",
                  background: "#0dcaf0",
                  color: "#000",
                  border: "none",
                  borderRadius: "14px",
                  fontSize: "11px",
                  fontWeight: "bold",
                  cursor: "pointer",
                }}
              >
                +10m
              </button>
              <button
                onClick={(e) => handleAddSight(selectedDotUI.id, e)}
                style={{
                  padding: "5px 10px",
                  background: "#20c997",
                  color: "#fff",
                  border: "none",
                  borderRadius: "14px",
                  fontSize: "11px",
                  fontWeight: "bold",
                  cursor: "pointer",
                }}
              >
                +100m
              </button>
              <button
                onClick={(e) => handleTeleport(selectedDotUI.id, e)}
                style={{
                  padding: "5px 10px",
                  background: "#6f42c1",
                  color: "#fff",
                  border: "none",
                  borderRadius: "14px",
                  fontSize: "11px",
                  fontWeight: "bold",
                  cursor: "pointer",
                }}
              >
                TP
              </button>
              <button
                onClick={(e) => handleStop(selectedDotUI.id, e)}
                style={{
                  padding: "5px 12px",
                  background: "#dc3545",
                  color: "#fff",
                  border: "none",
                  borderRadius: "14px",
                  fontSize: "11px",
                  fontWeight: "bold",
                  cursor: "pointer",
                }}
              >
                Stop
              </button>
              <button
                onClick={() => handleToggleSelect(selectedDotUI.id)}
                style={{
                  padding: "5px 12px",
                  background: "#e0e0e0",
                  color: "#333",
                  border: "none",
                  borderRadius: "14px",
                  fontSize: "11px",
                  fontWeight: "bold",
                  cursor: "pointer",
                }}
              >
                ✕ Hide
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}