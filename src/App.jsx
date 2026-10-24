import React, { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { initGraph, snap, pathfind } from "./fetch";

const SATELLITE_TILES_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const STREET_TILES_URL =
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

const BASE_STYLE = {
  version: 8,
  sources: {
    "satellite-tiles": {
      type: "raster",
      tiles: [SATELLITE_TILES_URL],
      tileSize: 256,
      maxzoom: 19,
    },
    "street-tiles": {
      type: "raster",
      tiles: [STREET_TILES_URL],
      tileSize: 256,
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: "street-layer",
      type: "raster",
      source: "street-tiles",
      minzoom: 0,
      maxzoom: 22,
      layout: {
        visibility: "none",
      },
    },
    {
      id: "satellite-layer",
      type: "raster",
      source: "satellite-tiles",
      minzoom: 0,
      maxzoom: 22,
      layout: {
        visibility: "visible",
      },
    },
  ],
};

const TEAM_COLORS = [
  "#D50000", "#FF5500", "#C87800", "#008828",
  "#5EA800", "#0088D6", "#002BFF", "#5500FF",
  "#FF1464", "#7B3800", "#66002A", "#003866",
];

const OUR_TEAM_COLOR = TEAM_COLORS[0];

const INITIAL_PRIORITY = {
  2: 0, // Chopper
  1: 1, // Cruiser
  0: 2, // Officer
  3: 3, // Runner
};

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

function createCircleGeoJSON(centerLat, centerLon, radiusMeters, points = 32) {
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

// Mobile-safe cross-platform emoji texture generator
function createEmojiImage(symbol, isSelected) {
  const canvas = document.createElement("canvas");
  const size = 128;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  ctx.clearRect(0, 0, size, size);

  if (isSelected) {
    ctx.filter = `drop-shadow(0 0 14px ${OUR_TEAM_COLOR}) drop-shadow(0 0 6px ${OUR_TEAM_COLOR})`;
  } else {
    ctx.filter = `drop-shadow(0 0 5px ${OUR_TEAM_COLOR})`;
  }

  ctx.font = "64px 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(symbol, size / 2, size / 2);

  const imgData = ctx.getImageData(0, 0, size, size);
  return {
    width: size,
    height: size,
    data: imgData.data,
  };
}

// Mobile-optimized Fog-of-War Layer without pipeline breaking `discard`
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
        precision mediump float;
        uniform vec2 u_resolution;
        uniform vec2 u_centers[4];
        uniform float u_radii[4];
        uniform int u_unit_count;

        void main() {
          vec2 fragCoord = gl_FragCoord.xy;
          fragCoord.y = u_resolution.y - fragCoord.y;

          float minFog = 0.72;

          for (int i = 0; i < 4; i++) {
            if (i >= u_unit_count) break;
            float d = distance(fragCoord, u_centers[i]);
            float rInner = u_radii[i] * 0.6667;
            float rOuter = u_radii[i];

            if (d < rInner) {
              minFog = 0.0;
            } else if (d < rOuter) {
              float factor = (d - rInner) / (rOuter - rInner);
              minFog = min(minFog, factor * 0.72);
            }
          }

          // Do NOT discard on mobile GPUs to avoid corrupting MapLibre's stencil/depth pipeline
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

    render(gl) {
      if (!unitsPlacedRef.current) return;

      gl.useProgram(this.program);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      const map = this.map;
      const canvas = map.getCanvas();
      const width = canvas.width;
      const height = canvas.height;

      gl.uniform2f(this.uRes, width, height);
      gl.uniform1i(this.uCount, dotsRef.current.length);

      const centers = [];
      const radii = [];

      dotsRef.current.forEach((dot) => {
        const pt = map.project([dot.pos[1], dot.pos[0]]);
        const dpr = window.devicePixelRatio || 1;
        centers.push(pt.x * dpr, pt.y * dpr);

        const latRad = dot.pos[0] * (Math.PI / 180);
        const zoom = map.getZoom();
        const metersPerPx = (40075016.686 * Math.cos(latRad)) / (512 * Math.pow(2, zoom));
        const sightRadius = dot.sightRadius || 600;
        radii.push((sightRadius / metersPerPx) * dpr);
      });

      gl.uniform2fv(this.uCenters, new Float32Array(centers));
      gl.uniform1fv(this.uRadii, new Float32Array(radii));

      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.enableVertexAttribArray(this.aPos);
      gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // Reset buffer to prevent leaking into MapLibre symbol render loops
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    },
  };
}

export default function App() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const isMapReadyRef = useRef(false);
  const unitsPlacedRef = useRef(false);

  const [selectedId, setSelectedId] = useState(null);
  const selectedIdRef = useRef(null);
  const [mapMode, setMapMode] = useState("satellite");

  const selectionHistoryRef = useRef([]);

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
      sightRadius: 600,
    }))
  );

  const dotsRef = useRef(
    DOT_CONFIGS.map((cfg) => ({
      id: cfg.id,
      name: cfg.name,
      symbol: cfg.symbol,
      pos: [22.3193, 114.1694],
      state: "Stop",
      speed: 20.0,
      radius: 25,
      targetRadius: 25,
      sightRadius: 600,
      targetSightRadius: 600,
      waypoints: [],
      waterFlags: [],
      segIdx: 0,
      nextAllowedClick: 0,
      redirectStart: 0,
      ferryTarget: null,
      distLeft: "--",
    }))
  );

  const toggleMapMode = () => {
    const map = mapRef.current;
    if (!map || !isMapReadyRef.current) return;

    const nextMode = mapMode === "satellite" ? "street" : "satellite";
    setMapMode(nextMode);

    if (nextMode === "street") {
      map.setLayoutProperty("satellite-layer", "visibility", "none");
      map.setLayoutProperty("street-layer", "visibility", "visible");
    } else {
      map.setLayoutProperty("street-layer", "visibility", "none");
      map.setLayoutProperty("satellite-layer", "visibility", "visible");
    }
  };

  const syncMapGraphics = () => {
    const map = mapRef.current;
    if (!map || !isMapReadyRef.current) return;

    const lineFeatures = [];
    const ringFeatures = [];
    const visionFeatures = [];
    const unitFeatures = [];

    const activeSelectedId = selectedIdRef.current;
    const history = selectionHistoryRef.current;

    const getUnitPriority = (id) => {
      if (id === activeSelectedId) return 100000;
      const historyIndex = history.indexOf(id);
      if (historyIndex !== -1) {
        return 5000 - historyIndex;
      }
      return INITIAL_PRIORITY[id];
    };

    const sortedDots = [...dotsRef.current].sort(
      (a, b) => getUnitPriority(a.id) - getUnitPriority(b.id)
    );

    sortedDots.forEach((dot) => {
      const { waypoints, waterFlags, segIdx, pos, radius, id } = dot;
      const isSelected = id === activeSelectedId;
      const priority = getUnitPriority(id);

      if (waypoints && waypoints.length > 1 && segIdx < waypoints.length - 1) {
        for (let i = segIdx; i < waypoints.length - 1; i++) {
          const start = i === segIdx ? [pos[1], pos[0]] : [waypoints[i][1], waypoints[i][0]];
          const end = [waypoints[i + 1][1], waypoints[i + 1][0]];

          lineFeatures.push({
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: [start, end],
            },
            properties: {
              isWater: waterFlags[i] === 1,
            },
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

      unitFeatures.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [pos[1], pos[0]],
        },
        properties: {
          id: dot.id,
          icon: isSelected ? `unit-icon-${dot.id}-selected` : `unit-icon-${dot.id}-normal`,
          isSelected,
          priority,
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

    const unitSource = map.getSource("player-units");
    if (unitSource) {
      unitSource.setData({ type: "FeatureCollection", features: unitFeatures });
    }

    map.triggerRepaint();
  };

  useEffect(() => {
    if (!mapContainerRef.current) return;

    const MapConstructor = maplibregl.Map || maplibregl.default?.Map;

    const map = new MapConstructor({
      container: mapContainerRef.current,
      style: BASE_STYLE,
      center: [114.1694, 22.3193],
      zoom: 12,
      minZoom: 10,
      maxZoom: 19,
      attributionControl: false,
    });

    mapRef.current = map;

    map.on("load", () => {
      isMapReadyRef.current = true;

      // Register both normal and selected emoji textures safely with pixel ratios
      DOT_CONFIGS.forEach((cfg) => {
        const normalImg = createEmojiImage(cfg.symbol, false);
        const selectedImg = createEmojiImage(cfg.symbol, true);
        map.addImage(`unit-icon-${cfg.id}-normal`, normalImg, { pixelRatio: 2 });
        map.addImage(`unit-icon-${cfg.id}-selected`, selectedImg, { pixelRatio: 2 });
      });

      map.addSource("opponent-units", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
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
            10, 1,
            20, 200,
          ],
          "circle-color": ["get", "color"],
          "circle-opacity": 0.15,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": ["get", "color"],
          "circle-stroke-opacity": 0.5,
        },
      });

      map.addSource("unit-paths", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: "unit-paths-layer",
        type: "line",
        source: "unit-paths",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-width": 5,
          "line-color": [
            "case",
            ["==", ["get", "isWater"], true],
            "rgba(0, 119, 190, 0.7)",
            "rgba(30, 130, 76, 0.7)",
          ],
        },
      });

      map.addSource("dest-rings", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: "dest-rings-layer",
        type: "line",
        source: "dest-rings",
        paint: {
          "line-color": OUR_TEAM_COLOR,
          "line-width": 2,
          "line-dasharray": [2, 2],
        },
      });

      map.addSource("vision-circles", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: "vision-circles-fill",
        type: "fill",
        source: "vision-circles",
        paint: {
          "fill-color": OUR_TEAM_COLOR,
          "fill-opacity": 0.22,
        },
      });

      map.addLayer({
        id: "vision-circles-stroke",
        type: "line",
        source: "vision-circles",
        paint: {
          "line-color": OUR_TEAM_COLOR,
          "line-width": 1.5,
        },
      });

      // Fog layer
      map.addLayer(createFogLayer(dotsRef, unitsPlacedRef));

      // Player Unit Emoji Icons
      map.addSource("player-units", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: "player-units-layer",
        type: "symbol",
        source: "player-units",
        layout: {
          "icon-image": ["get", "icon"],
          "icon-size": [
            "case",
            ["==", ["get", "isSelected"], true],
            0.55,
            0.48,
          ],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "symbol-sort-key": ["get", "priority"],
        },
      });

      initGraph()
        .then(async ({ bbox }) => {
          map.fitBounds(
            [
              [bbox[0][1], bbox[0][0]],
              [bbox[1][1], bbox[1][0]],
            ],
            { padding: 20, duration: 0 }
          );

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

          const opponentPromises = [];
          for (let teamIdx = 1; teamIdx < TEAM_COLORS.length; teamIdx++) {
            const teamColor = TEAM_COLORS[teamIdx];
            DOT_CONFIGS.forEach((cfg) => {
              const randLat = bbox[0][0] + Math.random() * (bbox[1][0] - bbox[0][0]);
              const randLon = bbox[0][1] + Math.random() * (bbox[1][0] - bbox[0][1]);
              opponentPromises.push(
                snap(randLat, randLon).then((res) => ({
                  pt: res.pt,
                  symbol: cfg.symbol,
                  teamColor,
                }))
              );
            });
          }

          const opponentUnits = await Promise.all(opponentPromises);
          const features = opponentUnits.map(({ pt, teamColor }) => ({
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [pt[1], pt[0]],
            },
            properties: { color: teamColor },
          }));

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
      map.remove();
      mapRef.current = null;
      isMapReadyRef.current = false;
      unitsPlacedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let animId;
    let lastTime = performance.now();
    let lastUIUpdate = 0;

    const loop = (now) => {
      const dt = (now - lastTime) / 1000.0;
      lastTime = now;

      dotsRef.current.forEach((dot) => {
        if (dot.radius < dot.targetRadius) {
          dot.radius = Math.min(dot.targetRadius, dot.radius + 100.0 * dt);
        } else if (dot.radius > dot.targetRadius) {
          dot.radius = Math.max(dot.targetRadius, dot.radius - 100.0 * dt);
        }

        if (dot.sightRadius < dot.targetSightRadius) {
          dot.sightRadius = Math.min(dot.targetSightRadius, dot.sightRadius + 1000.0 * dt);
        } else if (dot.sightRadius > dot.targetSightRadius) {
          dot.sightRadius = Math.max(dot.targetSightRadius, dot.sightRadius - 1000.0 * dt);
        }

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
            radius: Math.round(d.targetRadius),
            sightRadius: Math.round(d.targetSightRadius),
          }))
        );
        lastUIUpdate = now;
      }

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, []);

  const handleToggleSelect = (id) => {
    const map = mapRef.current;
    if (!map) return;

    if (selectedIdRef.current === id) {
      selectedIdRef.current = null;
      setSelectedId(null);
    } else {
      selectedIdRef.current = id;
      setSelectedId(id);

      const currentHistory = selectionHistoryRef.current.filter((item) => item !== id);
      selectionHistoryRef.current = [id, ...currentHistory];

      const dot = dotsRef.current[id];
      if (dot) {
        map.panTo([dot.pos[1], dot.pos[0]], { duration: 400 });
      }
    }

    syncMapGraphics();
  };

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

        dot.nextAllowedClick = performance.now() + 200;
        dot.state = newFlags[0] === 1 ? "Ferry" : "Move";
      } else {
        dot.state = "Redirecting";

        const startPos = dot.pos;
        const snapC = await snap(clickLat, clickLon);
        const snapStart = await snap(startPos[0], startPos[1]);
        const { flatPolyline, waterFlags } = await pathfind(snapStart, snapC);

        const newWaypoints = [];
        for (let i = 0; i < flatPolyline.length; i += 2) {
          newWaypoints.push([flatPolyline[i], flatPolyline[i + 1]]);
        }

        dot.waypoints = newWaypoints;
        dot.waterFlags = Array.from(waterFlags);
        dot.segIdx = 0;
        dot.pos = newWaypoints[0];

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

  const handleAddReach = (id, e) => {
    e.stopPropagation();
    const dot = dotsRef.current[id];
    if (dot) {
      dot.targetRadius = (dot.targetRadius || dot.radius) + 10;
    }
  };

  const handleAddSight = (id, e) => {
    e.stopPropagation();
    const dot = dotsRef.current[id];
    if (dot) {
      dot.targetSightRadius = (dot.targetSightRadius || dot.sightRadius || 600) + 100;
    }
  };

  const handleStop = (id, e) => {
    e.stopPropagation();
    const dot = dotsRef.current[id];
    if (!dot || dot.state === "Stop") return;

    if (dot.state === "Move") {
      dot.state = "Stop";
      dot.waypoints = [];
      dot.waterFlags = [];
      dot.segIdx = 0;
      dot.ferryTarget = null;
      dot.timeLeft = "--";
      dot.eta = "--";
      dot.distLeft = "--";
    } else if (dot.state === "Ferry" || (dot.state === "Redirecting" && dot.waterFlags[dot.segIdx] === 1)) {
      const { waypoints, waterFlags, segIdx } = dot;
      let landNodeIdx = waypoints.length - 1;
      for (let i = segIdx; i < waterFlags.length; i++) {
        if (waterFlags[i] === 0) {
          landNodeIdx = i;
          break;
        }
      }

      dot.waypoints = waypoints.slice(0, landNodeIdx + 1);
      dot.waterFlags = waterFlags.slice(0, landNodeIdx);
      dot.ferryTarget = null;
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
    dot.state = "Stop";
    dot.timeLeft = "--";
    dot.eta = "--";
    dot.distLeft = "--";
  };

  const selectedDotUI = dotsUI.find((d) => d.id === selectedId);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh", // Fallback for older browsers
        height: "100dvh",
        margin: 0,
        padding: 0,
        overflow: "hidden",
        backgroundColor: "#1a1a1a",
      }}
    >
      {/* 1. Fully GPU-Accelerated WebGL Map */}
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

      {/* 2. Top-Left Basemap Toggle Button */}
      <div
        style={{
          position: "absolute",
          top: "calc(16px + env(safe-area-inset-top, 0px))",
          left: 16,
          zIndex: 40,
        }}
      >
        <button
          onClick={toggleMapMode}
          style={{
            backgroundColor: "#ffffff",
            color: "#111827",
            border: "1px solid rgba(0, 0, 0, 0.1)",
            padding: "8px 14px",
            borderRadius: "8px",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.25)",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            userSelect: "none",
            outline: "none",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          {mapMode === "satellite" ? "🗺️ Map View" : "🛰️ Satellite View"}
        </button>
      </div>

      {/* 3. Left-Hand Unit Selection Toolbar */}
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
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {dot.symbol}
            </button>
          );
        })}
      </div>

      {/* 4. Bottom Tactical Card */}
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
          gap: "10px",
          transform: selectedDotUI ? "translateY(0)" : "translateY(110%)",
          transition: "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
          pointerEvents: selectedDotUI ? "auto" : "none",
          maxHeight: "80dvh",
          overflowY: "auto",
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

            <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontSize: "12px", color: "#333" }}>
                <span style={{ fontSize: "10px", color: "#888", display: "block" }}>ETA</span>
                <b>{selectedDotUI.eta}</b>
              </div>
              <div style={{ fontSize: "12px", color: "#333" }}>
                <span style={{ fontSize: "10px", color: "#888", display: "block" }}>Time</span>
                <b>{selectedDotUI.timeLeft}</b>
              </div>
              <div style={{ fontSize: "12px", color: "#333" }}>
                <span style={{ fontSize: "10px", color: "#888", display: "block" }}>Dist</span>
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
                <b>{selectedDotUI.sightRadius} m</b>
              </div>
            </div>

            <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
              <button
                onClick={(e) => handleStop(selectedDotUI.id, e)}
                style={{
                  padding: "6px 10px",
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
                onClick={(e) => handleAddSpeed(selectedDotUI.id, e)}
                style={{
                  padding: "6px 10px",
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
                onClick={(e) => handleAddReach(selectedDotUI.id, e)}
                style={{
                  padding: "6px 10px",
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
                  padding: "6px 10px",
                  background: "#ffc107",
                  color: "#000",
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
                  padding: "6px 10px",
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
                onClick={() => handleToggleSelect(selectedDotUI.id)}
                style={{
                  padding: "6px 12px",
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