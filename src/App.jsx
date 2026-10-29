import React, { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { initGraph, snap, pathfind } from "./fetch";
import {
  INITIAL_CIRCLE_CENTER_LAT,
  INITIAL_CIRCLE_CENTER_LON,
  INITIAL_CIRCLE_RADIUS_METERS,
  START_GAME_SECONDS,
  END_GAME_SECONDS,
  TIME_SCALE,
  MAP_STYLE,
  SATELLITE_STYLE,
  TEAM_COLORS,
  DOT_CONFIGS,
  STATE_COLORS,
  getZoneState,
  calculateDynamicBounds,
  formatGameClock,
  formatEtaRounded,
  formatDurationRounded,
  formatRadiusDisplay,
  haversineMeters,
  createCircleGeoJSON,
  createBorderShrinkLayer,
  createFogLayer,
} from "./gameConfig";

const GREY_STORM_COLOR = "#60646c";

export default function App() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const isMapReadyStateRef = useRef(false);
  const unitsPlacedRef = useRef(false);
  const markersRef = useRef(new Map());
  const destMarkersRef = useRef(new Map());
  const opponentFeaturesRef = useRef([]);

  const selectionOrderRef = useRef(DOT_CONFIGS.map((c) => c.id));

  // Game sequence: "INITIAL" | "INTRO" | "PLACE_HUNTERS" | "PLACE_RUNNER" | "FOG_FADE" | "COUNTDOWN" | "PLAYING"
  const [gameState, setGameState] = useState("INITIAL");
  const gameStateRef = useRef("INITIAL");

  // Dynamic fog opacity reference: 0.0 initially, fades 0.0 -> 1.0 over 5s after confirming runner
  const fogOpacityRef = useRef(0.0);
  const fogFadeStartRef = useRef(0);

  // Countdown state
  const [countdownNumber, setCountdownNumber] = useState(10);
  const countdownIntervalRef = useRef(null);

  // Placement tracking
  const hunterClickCountRef = useRef(0);
  const [placedHuntersCount, setPlacedHuntersCount] = useState(0);
  const [runnerPlaced, setRunnerPlaced] = useState(false);
  const isSnappingRef = useRef(false);

  const [selectedColor, setSelectedColor] = useState(null);
  const [ourTeamColor, setOurTeamColor] = useState(GREY_STORM_COLOR);
  const ourTeamColorRef = useRef(GREY_STORM_COLOR);

  const [hudSlidingIn, setHudSlidingIn] = useState(false);
  const hudSlidingInRef = useRef(false);
  const introStartRef = useRef(0);

  const [isSatellite, setIsSatellite] = useState(true);
  const isSatelliteRef = useRef(true);
  isSatelliteRef.current = isSatellite;

  const [selectedId, setSelectedId] = useState(null);
  const selectedIdRef = useRef(null);

  // Time & Zone tracking
  const [gameSeconds, setGameSeconds] = useState(START_GAME_SECONDS);
  const gameSecondsRef = useRef(START_GAME_SECONDS);

  const zoneStateRef = useRef({
    ...getZoneState(START_GAME_SECONDS),
    radius: 0,
    isShrinking: false,
    originRadius: 0,
    nextTargetR: null,
  });
  const [zoneUI, setZoneUI] = useState(zoneStateRef.current);

  const [dotsUI, setDotsUI] = useState(
    DOT_CONFIGS.map((cfg) => ({
      id: cfg.id,
      name: cfg.name,
      symbol: cfg.symbol,
      state: "Stop",
      eta: "--",
      timeLeft: "--",
      distLeft: "--",
      speed: 2,
      radius: 30,
      sight: 200,
    }))
  );

  const dotsRef = useRef(
    DOT_CONFIGS.map((cfg) => ({
      id: cfg.id,
      name: cfg.name,
      symbol: cfg.symbol,
      pos: [22.3193, 114.1694],
      isPlaced: false,
      state: "Stop",
      preRedirectState: null,
      redirectRequestId: 0,
      speed: 2.5,
      radius: 30,
      sight: 200,
      waypoints: [],
      waterFlags: [],
      segIdx: 0,
      nextAllowedClick: 0,
      redirectStart: 0,
      ferryTarget: null,
      distLeft: "--",
    }))
  );

  // Lock and unlock zoom depending on color selection state
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (gameState === "INITIAL") {
      map.scrollZoom.disable();
      map.doubleClickZoom.disable();
      map.touchZoomRotate.disable();
      map.boxZoom.disable();
    } else {
      map.scrollZoom.enable();
      map.doubleClickZoom.enable();
      map.touchZoomRotate.enable();
      map.boxZoom.enable();
    }
  }, [gameState]);

  // Start in-game timer ONLY when entering PLAYING state
  useEffect(() => {
    if (gameState !== "PLAYING") return;

    const timer = setInterval(() => {
      if (gameSecondsRef.current >= END_GAME_SECONDS) {
        clearInterval(timer);
        return;
      }
      gameSecondsRef.current += 1;
      const currentSec = gameSecondsRef.current;
      setGameSeconds(currentSec);

      const zone = getZoneState(currentSec);
      zoneStateRef.current = zone;
      setZoneUI(zone);
    }, 50);

    return () => clearInterval(timer);
  }, [gameState]);

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
    if (!map || !isMapReadyStateRef.current) return;

    const zone = zoneStateRef.current;
    const isPlayingOrIntro = gameStateRef.current !== "INITIAL";

    // 1. Glowing perimeter circle
    const glowSource = map.getSource("glowing-circle-source");
    if (glowSource) {
      if (zone && zone.radius > 0 && isPlayingOrIntro) {
        const circlePolyCoords = createCircleGeoJSON(zone.center[0], zone.center[1], zone.radius, 128);
        glowSource.setData({
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
        });
      } else {
        glowSource.setData({ type: "FeatureCollection", features: [] });
      }
    }

    // 2. Initial Non-Shrunken Circle
    const originSource = map.getSource("shrink-origin-circle-source");
    if (originSource) {
      if (
        gameStateRef.current === "PLAYING" &&
        zone &&
        zone.isShrinking &&
        zone.originRadius > 0 &&
        zone.originCenter
      ) {
        const originCoords = createCircleGeoJSON(
          zone.originCenter[0],
          zone.originCenter[1],
          zone.originRadius,
          128
        );
        originSource.setData({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: {
                type: "Polygon",
                coordinates: [originCoords],
              },
            },
          ],
        });
      } else {
        originSource.setData({ type: "FeatureCollection", features: [] });
      }
    }

    // 3. Glowing Dashed Next Zone Circle
    const nextZoneSource = map.getSource("next-zone-circle-source");
    if (nextZoneSource) {
      if (
        gameStateRef.current === "PLAYING" &&
        zone &&
        zone.nextTargetR !== null &&
        zone.nextTargetR > 0 &&
        zone.nextTargetCenter
      ) {
        const nextCircleCoords = createCircleGeoJSON(
          zone.nextTargetCenter[0],
          zone.nextTargetCenter[1],
          zone.nextTargetR,
          128
        );
        nextZoneSource.setData({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: {
                type: "Polygon",
                coordinates: [nextCircleCoords],
              },
            },
          ],
        });
      } else {
        nextZoneSource.setData({ type: "FeatureCollection", features: [] });
      }
    }

    // 4. Unit & Destination Markers
    dotsRef.current.forEach((dot) => {
      const marker = markersRef.current.get(dot.id);
      if (marker) {
        marker.setLngLat([dot.pos[1], dot.pos[0]]);
        const el = marker.getElement();
        el.style.display = dot.isPlaced ? "flex" : "none";
      }

      const destMarker = destMarkersRef.current.get(dot.id);
      if (destMarker) {
        const hasDest =
          gameStateRef.current === "PLAYING" &&
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

    // 5. Polylines, rings, and vision
    const lineFeatures = [];
    const ringFeatures = [];
    const visionFeatures = [];

    if (gameStateRef.current === "PLAYING") {
      dotsRef.current.forEach((dot) => {
        if (!dot.isPlaced) return;
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
    }

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
    const nextZoneColor = isSatelliteRef.current ? "#FFEA00" : "#111111";

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
        maxzoom: 19,
        layout: {
          visibility: isSatelliteRef.current ? "visible" : "none",
        },
      });
    }

    if (!map.getLayer("border-shrink-layer")) {
      map.addLayer(createBorderShrinkLayer(ourTeamColorRef, zoneStateRef));
    }

    if (!map.getSource("shrink-origin-circle-source")) {
      map.addSource("shrink-origin-circle-source", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: "shrink-origin-circle-outer",
        type: "line",
        source: "shrink-origin-circle-source",
        paint: {
          "line-color": teamColor,
          "line-width": 18,
          "line-blur": 10,
          "line-opacity": 0.45,
          "line-dasharray": [3, 2],
        },
      });

      map.addLayer({
        id: "shrink-origin-circle-mid",
        type: "line",
        source: "shrink-origin-circle-source",
        paint: {
          "line-color": teamColor,
          "line-width": 7,
          "line-blur": 3,
          "line-opacity": 0.75,
          "line-dasharray": [3, 2],
        },
      });

      map.addLayer({
        id: "shrink-origin-circle-core",
        type: "line",
        source: "shrink-origin-circle-source",
        paint: {
          "line-color": teamColor,
          "line-width": 2.5,
          "line-opacity": 1.0,
          "line-dasharray": [3, 2],
        },
      });
    }

    if (!map.getSource("glowing-circle-source")) {
      map.addSource("glowing-circle-source", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: "glowing-circle-outer",
        type: "line",
        source: "glowing-circle-source",
        paint: {
          "line-color": teamColor,
          "line-width": 18,
          "line-blur": 10,
          "line-opacity": 0.45,
        },
      });

      map.addLayer({
        id: "glowing-circle-mid",
        type: "line",
        source: "glowing-circle-source",
        paint: {
          "line-color": teamColor,
          "line-width": 7,
          "line-blur": 3,
          "line-opacity": 0.75,
        },
      });

      map.addLayer({
        id: "glowing-circle-core",
        type: "line",
        source: "glowing-circle-source",
        paint: {
          "line-color": teamColor,
          "line-width": 2.5,
          "line-opacity": 1.0,
        },
      });
    }

    if (!map.getSource("next-zone-circle-source")) {
      map.addSource("next-zone-circle-source", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: "next-zone-circle-glow",
        type: "line",
        source: "next-zone-circle-source",
        paint: {
          "line-color": nextZoneColor,
          "line-width": 8,
          "line-blur": 5,
          "line-opacity": 0.6,
          "line-dasharray": [3, 2],
        },
      });

      map.addLayer({
        id: "next-zone-circle-core",
        type: "line",
        source: "next-zone-circle-source",
        paint: {
          "line-color": nextZoneColor,
          "line-width": 2.5,
          "line-opacity": 0.95,
          "line-dasharray": [3, 2],
        },
      });
    }

    if (!map.getSource("opponent-units")) {
      map.addSource("opponent-units", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
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

    if (!map.getLayer("fog-of-war-layer")) {
      map.addLayer(createFogLayer(dotsRef, unitsPlacedRef, fogOpacityRef));
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
      center: [INITIAL_CIRCLE_CENTER_LON, INITIAL_CIRCLE_CENTER_LAT],
      zoom: 10.5,
      minZoom: 9,
      maxZoom: 18.5,
      maxBounds: initialBounds,
      maxBoundsViscosity: 0.0,
      attributionControl: false,
    });

    mapRef.current = map;

    // Disallow zooming when initially selecting color
    map.scrollZoom.disable();
    map.doubleClickZoom.disable();
    map.touchZoomRotate.disable();
    map.boxZoom.disable();

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
      isMapReadyStateRef.current = true;
      setupLayers(map);

      map.fitBounds(initialBounds, { padding: 0, duration: 0 });

      dotsRef.current.forEach((dot) => {
        const MarkerClass = maplibregl.Marker || maplibregl.default?.Marker;

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

        const el = document.createElement("div");
        el.id = `marker-unit-${dot.id}`;
        el.innerText = dot.symbol;
        el.style.fontSize = "24px";
        el.style.width = "40px";
        el.style.height = "40px";
        el.style.display = "none";
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
        })
        .catch((err) => console.error("Init Error:", err));
    });

    return () => {
      window.removeEventListener("resize", handleResize);
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();
      destMarkersRef.current.forEach((m) => m.remove());
      destMarkersRef.current.clear();
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      map.remove();
      mapRef.current = null;
      isMapReadyStateRef.current = false;
      unitsPlacedRef.current = false;
    };
  }, []);

  // Main 60 FPS Animation Loop
  useEffect(() => {
    let animId;
    let lastTime = performance.now();
    let lastUIUpdate = 0;

    const loop = (now) => {
      const dt = (now - lastTime) / 1000.0;
      lastTime = now;

      // 1. 3-SECOND CIRCLE EXPANSION SEQUENCE
      if (gameStateRef.current === "INTRO") {
        const elapsed = now - introStartRef.current;
        const progress = Math.min(1.0, elapsed / 3000.0);

        const currentRadius = INITIAL_CIRCLE_RADIUS_METERS * progress;

        zoneStateRef.current = {
          phase: 1,
          isShrinking: false,
          radius: currentRadius,
          center: [INITIAL_CIRCLE_CENTER_LAT, INITIAL_CIRCLE_CENTER_LON],
          remainingSec: 0,
          targetEndSec: 0,
          nextTargetR: null,
          nextTargetCenter: null,
          originRadius: 0,
          originCenter: null,
        };

        // Slide in top modal exactly 1 second before PLACE_HUNTERS mode (at 2000ms)
        if (elapsed >= 2000 && !hudSlidingInRef.current) {
          hudSlidingInRef.current = true;
          setHudSlidingIn(true);
        }

        if (elapsed >= 3000) {
          gameStateRef.current = "PLACE_HUNTERS";
          setGameState("PLACE_HUNTERS");

          zoneStateRef.current = {
            ...getZoneState(START_GAME_SECONDS),
            radius: INITIAL_CIRCLE_RADIUS_METERS,
            isShrinking: false,
            originRadius: 0,
            nextTargetR: null,
          };
          setZoneUI(zoneStateRef.current);
        }
      }

      // 2. 5-SECOND FOG FADE-IN
      if (gameStateRef.current === "FOG_FADE") {
        const elapsed = now - fogFadeStartRef.current;
        const progress = Math.min(1.0, elapsed / 5000.0);
        fogOpacityRef.current = progress; // 0.0 -> 1.0

        if (elapsed >= 5000) {
          fogOpacityRef.current = 1.0;
          gameStateRef.current = "COUNTDOWN";
          setGameState("COUNTDOWN");

          let count = 10;
          setCountdownNumber(count);

          countdownIntervalRef.current = setInterval(() => {
            count -= 1;
            if (count > 0) {
              setCountdownNumber(count);
            } else {
              clearInterval(countdownIntervalRef.current);
              countdownIntervalRef.current = null;
              gameStateRef.current = "PLAYING";
              setGameState("PLAYING");

              // Reveal opponent units when the game starts
              const map = mapRef.current;
              if (map) {
                const src = map.getSource("opponent-units");
                if (src) {
                  src.setData({
                    type: "FeatureCollection",
                    features: opponentFeaturesRef.current,
                  });
                }
              }
            }
          }, 1000);
        }
      }

      // 3. UNIT MOVEMENT IN PLAYING STATE
      if (gameStateRef.current === "PLAYING") {
        const isGameFinished = gameSecondsRef.current >= END_GAME_SECONDS;

        if (!isGameFinished) {
          dotsRef.current.forEach((dot) => {
            const { state, waypoints } = dot;
            let segIdx = dot.segIdx;

            const isFerryRedirect = state === "Redirecting" && dot.ferryTarget !== null;
            const canMove = state === "Move" || state === "Ferry" || isFerryRedirect;

            if (canMove && waypoints.length > 1 && segIdx < waypoints.length - 1) {
              let distanceToAdvance = dot.speed * (dt * TIME_SCALE);

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
                let remDist = haversineMeters(
                  dot.pos[0],
                  dot.pos[1],
                  waypoints[segIdx + 1][0],
                  waypoints[segIdx + 1][1]
                );
                for (let i = segIdx + 1; i < waypoints.length - 1; i++) {
                  remDist += haversineMeters(
                    waypoints[i][0],
                    waypoints[i][1],
                    waypoints[i + 1][0],
                    waypoints[i + 1][1]
                  );
                }
                const remGameSeconds = remDist / dot.speed;
                dot.timeLeft = formatDurationRounded(remGameSeconds);
                dot.eta = formatEtaRounded(gameSecondsRef.current + remGameSeconds);
                dot.distLeft =
                  remDist > 1000 ? (remDist / 1000).toFixed(2) + " km" : remDist.toFixed(0) + " m";
              }
            }
          });
        }
      }

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

  const updateMapTeamColor = (color) => {
    ourTeamColorRef.current = color;
    setOurTeamColor(color);

    const map = mapRef.current;
    if (!map) return;

    [
      "glowing-circle-outer",
      "glowing-circle-mid",
      "glowing-circle-core",
      "shrink-origin-circle-outer",
      "shrink-origin-circle-mid",
      "shrink-origin-circle-core",
      "dest-rings-layer",
      "vision-circles-stroke",
    ].forEach((layerId) => {
      if (map.getLayer(layerId)) {
        map.setPaintProperty(layerId, "line-color", color);
      }
    });

    if (map.getLayer("vision-circles-fill")) {
      map.setPaintProperty("vision-circles-fill", "fill-color", color);
    }

    markersRef.current.forEach((marker) => {
      const el = marker.getElement();
      el.style.filter = `drop-shadow(0 0 6px ${color})`;
    });
  };

  const handleSelectTeamColor = (color) => {
    setSelectedColor(color);
    updateMapTeamColor(color);
  };

  const handlePressPlay = () => {
    if (!selectedColor) return;
    introStartRef.current = performance.now();
    gameStateRef.current = "INTRO";
    setGameState("INTRO");
  };

  const handleConfirmHunters = () => {
    if (placedHuntersCount < 3) return;
    gameStateRef.current = "PLACE_RUNNER";
    setGameState("PLACE_RUNNER");
  };

  // Confirm runner: start 5s fog fade, reveal clock and normal progress text immediately
  const handleConfirmRunner = () => {
    if (!runnerPlaced) return;
    unitsPlacedRef.current = true;

    const initialZone = getZoneState(START_GAME_SECONDS);
    zoneStateRef.current = initialZone;
    setZoneUI(initialZone);

    fogFadeStartRef.current = performance.now();
    gameStateRef.current = "FOG_FADE";
    setGameState("FOG_FADE");
  };

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
      if (dot && dot.isPlaced) {
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

    const currentTeamColor = ourTeamColorRef.current;
    [
      "glowing-circle-outer",
      "glowing-circle-mid",
      "glowing-circle-core",
      "shrink-origin-circle-outer",
      "shrink-origin-circle-mid",
      "shrink-origin-circle-core",
    ].forEach((layerId) => {
      if (map.getLayer(layerId)) {
        map.setPaintProperty(layerId, "line-color", currentTeamColor);
      }
    });

    const nextColor = nextSatellite ? "#FFEA00" : "#111111";
    ["next-zone-circle-glow", "next-zone-circle-core"].forEach((layerId) => {
      if (map.getLayer(layerId)) {
        map.setPaintProperty(layerId, "line-color", nextColor);
      }
    });
  };

  // Map Click Handling
  useEffect(() => {
    if (!mapRef.current) return;

    const onMapClick = async (e) => {
      const curState = gameStateRef.current;
      const { lat: clickLat, lng: clickLon } = e.lngLat;

      if (curState === "PLACE_HUNTERS") {
        if (isSnappingRef.current) return;
        isSnappingRef.current = true;

        try {
          const snapped = await snap(clickLat, clickLon);
          const targetHunterId = hunterClickCountRef.current % 3;
          const unit = dotsRef.current[targetHunterId];

          unit.pos = snapped.pt;
          unit.isPlaced = true;

          const marker = markersRef.current.get(targetHunterId);
          if (marker) {
            marker.setLngLat([snapped.pt[1], snapped.pt[0]]);
            marker.getElement().style.display = "flex";
          }

          hunterClickCountRef.current += 1;
          setPlacedHuntersCount((prev) => Math.max(prev, hunterClickCountRef.current));
          syncMapGraphics();
        } catch (err) {
          console.error("Snap error:", err);
        } finally {
          isSnappingRef.current = false;
        }
        return;
      }

      if (curState === "PLACE_RUNNER") {
        if (isSnappingRef.current) return;
        isSnappingRef.current = true;

        try {
          const snapped = await snap(clickLat, clickLon);
          const runnerUnit = dotsRef.current[3];

          runnerUnit.pos = snapped.pt;
          runnerUnit.isPlaced = true;

          const marker = markersRef.current.get(3);
          if (marker) {
            marker.setLngLat([snapped.pt[1], snapped.pt[0]]);
            marker.getElement().style.display = "flex";
          }

          setRunnerPlaced(true);
          syncMapGraphics();
        } catch (err) {
          console.error("Snap error:", err);
        } finally {
          isSnappingRef.current = false;
        }
        return;
      }

      if (curState === "PLAYING") {
        if (gameSecondsRef.current >= END_GAME_SECONDS) return;

        const activeId = selectedIdRef.current;
        if (activeId === null) return;

        const dot = dotsRef.current[activeId];
        const now = performance.now();

        if (now < dot.nextAllowedClick || dot.state === "Redirecting") return;

        const unitCurState = dot.state;
        const waypoints = dot.waypoints;
        const flags = dot.waterFlags;
        const curSeg = dot.segIdx;

        dot.preRedirectState = unitCurState;
        dot.redirectRequestId = (dot.redirectRequestId || 0) + 1;
        const reqId = dot.redirectRequestId;

        dot.redirectStart = performance.now();

        if (unitCurState === "Ferry") {
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
      }
    };

    const map = mapRef.current;
    map.on("click", onMapClick);
    return () => map.off("click", onMapClick);
  }, []);

  const handleAddSpeed = (id, e) => {
    e.stopPropagation();
    const dot = dotsRef.current[id];
    if (dot) dot.speed = parseFloat((dot.speed + 0.5).toFixed(2));
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
      dot.sight = (dot.sight || 200) + 100;
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

  const currentRadius = zoneUI.radius;
  const radiusProgressRatio = Math.min(
    Math.max(1.0 - currentRadius / INITIAL_CIRCLE_RADIUS_METERS, 0.0),
    1.0
  );

  const displayedDiameter = formatRadiusDisplay(INITIAL_CIRCLE_RADIUS_METERS * 2);

  // Determine whether top text should show hunter/runner placement or clock
  const isHunterPhaseText = gameState === "INTRO" || gameState === "PLACE_HUNTERS";
  const isRunnerPhaseText = gameState === "PLACE_RUNNER";
  const isStaticPlacementBar = isHunterPhaseText || isRunnerPhaseText;
  const isActualPlacementInteraction = gameState === "PLACE_HUNTERS" || gameState === "PLACE_RUNNER";

  // Top header text logic (displays "Place Your Hunters!" as it slides down 1s prior)
  let headerText = formatGameClock(gameSeconds);
  if (isHunterPhaseText) headerText = "Place Your Hunters!";
  else if (isRunnerPhaseText) headerText = "Place Your Runner!";
  else if (gameState === "FOG_FADE" || gameState === "COUNTDOWN") headerText = formatGameClock(START_GAME_SECONDS);

  // Progress bar text logic (displays "Z1 ⏸️ ({d})" as it slides down 1s prior)
  let progressText = isStaticPlacementBar
    ? `Z1 ⏸️ (${displayedDiameter})`
    : `Z${zoneUI.phase} ${zoneUI.isShrinking ? "⏩" : "⏸️"} (${formatRadiusDisplay(
        currentRadius * 2
      )}, ${formatDurationRounded(zoneUI.remainingSec)} until ${
        zoneUI.isShrinking ? "⏸️" : "⏩"
      } at ${formatEtaRounded(zoneUI.targetEndSec)})`;

  // Modal visibility: drops down 1 second before PLACE_HUNTERS mode begins (at 2000ms)
  const isHUDVisible = hudSlidingIn || (gameState !== "INITIAL" && gameState !== "INTRO");

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
      <style>{`
        @keyframes moveStripes {
          0% { background-position: 0 0; }
          100% { background-position: 56px 0; }
        }
      `}</style>

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

      {/* 3x4 COLOR PICKER MODAL (INITIAL STATE) */}
      {gameState === "INITIAL" && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 60,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "24px 28px",
            background: "rgba(18, 20, 24, 0.88)",
            backdropFilter: "blur(14px)",
            borderRadius: "20px",
            border: `2px solid ${selectedColor || "rgba(255, 255, 255, 0.2)"}`,
            boxShadow: selectedColor
              ? `0 0 25px ${selectedColor}66, 0 8px 32px rgba(0,0,0,0.7)`
              : "0 8px 32px rgba(0,0,0,0.7)",
            fontFamily: "system-ui, -apple-system, sans-serif",
            userSelect: "none",
            transition: "border 0.2s ease, box-shadow 0.2s ease",
          }}
        >
          <div
            style={{
              fontSize: "13px",
              fontWeight: "700",
              letterSpacing: "1.5px",
              color: "#a0a5b0",
              textTransform: "uppercase",
              marginBottom: "16px",
            }}
          >
            Select Team Color
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 52px)",
              gridTemplateRows: "repeat(3, 52px)",
              gap: "12px",
              marginBottom: "20px",
            }}
          >
            {TEAM_COLORS.map((color) => {
              const isSelected = selectedColor === color;
              return (
                <button
                  key={color}
                  onClick={() => handleSelectTeamColor(color)}
                  style={{
                    width: "52px",
                    height: "52px",
                    borderRadius: "14px",
                    backgroundColor: color,
                    border: isSelected
                      ? "3.5px solid #ffffff"
                      : "2px solid rgba(0, 0, 0, 0.4)",
                    boxShadow: isSelected
                      ? `0 0 14px ${color}, inset 0 0 4px rgba(0,0,0,0.4)`
                      : "0 2px 6px rgba(0,0,0,0.3)",
                    transform: isSelected ? "scale(1.08)" : "scale(1)",
                    cursor: "pointer",
                    outline: "none",
                    padding: 0,
                    transition: "transform 0.15s ease, border 0.15s ease, box-shadow 0.15s ease",
                  }}
                />
              );
            })}
          </div>

          <button
            onClick={handlePressPlay}
            disabled={!selectedColor}
            style={{
              padding: "10px 42px",
              fontSize: "16px",
              fontWeight: "800",
              letterSpacing: "1px",
              borderRadius: "24px",
              border: "none",
              backgroundColor: selectedColor ? selectedColor : "#3a3d45",
              color: "#ffffff",
              cursor: selectedColor ? "pointer" : "not-allowed",
              boxShadow: selectedColor ? `0 4px 16px ${selectedColor}88` : "none",
              opacity: selectedColor ? 1 : 0.4,
              transition: "all 0.2s ease",
              outline: "none",
            }}
          >
            PLAY
          </button>
        </div>
      )}

      {/* COUNTDOWN NUMBER IN THE CENTER */}
      {gameState === "COUNTDOWN" && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 80,
            fontSize: "110px",
            fontWeight: "900",
            WebkitTextStroke: "6px #000000",
            paintOrder: "stroke fill",
            color: "#ffffff",
            fontFamily: "system-ui, -apple-system, sans-serif",
            fontVariantNumeric: "tabular-nums",
            userSelect: "none",
            pointerEvents: "none",
            textShadow:
              "-3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000, 3px 3px 0 #000, 0 8px 24px rgba(0,0,0,0.9)",
          }}
        >
          {countdownNumber}
        </div>
      )}

      {/* TOP CENTER: HEADER TEXT & PROGRESS BAR (Slides in 1s before PLACE_HUNTERS mode) */}
      <div
        style={{
          position: "absolute",
          top: "calc(16px + env(safe-area-inset-top, 0px))",
          left: "50%",
          transform: isHUDVisible ? "translate(-50%, 0)" : "translate(-50%, -200%)",
          opacity: isHUDVisible ? 1 : 0,
          transition: "transform 1s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.5s ease",
          zIndex: 40,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
          userSelect: "none",
          minWidth: "240px",
          background: "transparent",
          pointerEvents: isHUDVisible ? "auto" : "none",
        }}
      >
        <span
          style={{
            fontSize: isStaticPlacementBar ? "20px" : "24px",
            fontWeight: "800",
            letterSpacing: "0.8px",
            color: "#ffffff",
            fontVariantNumeric: "tabular-nums",
            textShadow:
              "-1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000, 0 2px 5px rgba(0,0,0,0.85)",
          }}
        >
          {headerText}
        </span>

        <div
          style={{
            position: "relative",
            width: "100%",
            height: "16px",
            backgroundColor: "#7e8388",
            borderRadius: "8px",
            overflow: "hidden",
            marginTop: "3px",
            boxShadow: "0 0 0 1.5px #000000, 0 2px 6px rgba(0,0,0,0.6)",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              height: "100%",
              width: `${isStaticPlacementBar ? 0 : (radiusProgressRatio * 100).toFixed(2)}%`,
              backgroundColor: ourTeamColor,
              backgroundImage: `repeating-linear-gradient(
                -45deg,
                rgba(255, 255, 255, 0.22) 0px,
                rgba(255, 255, 255, 0.22) 10px,
                transparent 10px,
                transparent 20px
              )`,
              backgroundSize: "28px 28px",
              animation: zoneUI.isShrinking ? "moveStripes 1.2s linear infinite" : "none",
              transition: "width 0.05s linear",
            }}
          />

          <span
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              fontSize: "9.5px",
              fontWeight: "800",
              color: "#ffffff",
              textShadow:
                "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 3px #000",
              pointerEvents: "none",
              whiteSpace: "nowrap",
            }}
          >
            {progressText}
          </span>
        </div>
      </div>

      {/* BOTTOM CONFIRM BUTTON */}
      {isActualPlacementInteraction && (
        <button
          onClick={gameState === "PLACE_HUNTERS" ? handleConfirmHunters : handleConfirmRunner}
          disabled={gameState === "PLACE_HUNTERS" ? placedHuntersCount < 3 : !runnerPlaced}
          style={{
            position: "absolute",
            bottom: "calc(24px + env(safe-area-inset-bottom, 0px))",
            left: "50%",
            transform: "translateX(-50%)",
            padding: "12px 42px",
            fontSize: "16px",
            fontWeight: "800",
            letterSpacing: "1.2px",
            borderRadius: "28px",
            border: "none",
            backgroundColor: ourTeamColor,
            color: "#ffffff",
            boxShadow: `0 4px 20px ${ourTeamColor}88, 0 2px 8px rgba(0,0,0,0.6)`,
            cursor:
              (gameState === "PLACE_HUNTERS" ? placedHuntersCount >= 3 : runnerPlaced)
                ? "pointer"
                : "not-allowed",
            opacity:
              (gameState === "PLACE_HUNTERS" ? placedHuntersCount >= 3 : runnerPlaced) ? 1 : 0.45,
            zIndex: 60,
            transition: "all 0.2s ease",
            outline: "none",
          }}
        >
          CONFIRM
        </button>
      )}

      {/* TOP-LEFT WHITE BUTTON: NEVER DISAPPEARS */}
      <button
        onClick={handleToggleStyle}
        style={{
          position: "absolute",
          top: "calc(16px + env(safe-area-inset-top, 0px))",
          left: 16,
          zIndex: 65,
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
        }}
        title={isSatellite ? "Switch to Map" : "Switch to Satellite"}
      >
        {isSatellite ? "🗺️" : "🌍"}
      </button>

      {/* UNIT SELECTION TOOLBAR */}
      <div
        style={{
          position: "absolute",
          bottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
          left: 16,
          transform: gameState === "PLAYING" ? "translateX(0)" : "translateX(-150px)",
          opacity: gameState === "PLAYING" ? 1 : 0,
          transition: "transform 1s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.5s ease",
          zIndex: 40,
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          pointerEvents: gameState === "PLAYING" ? "auto" : "none",
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

      {/* BOTTOM TACTICAL DRAWER */}
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
          transform: selectedDotUI && gameState === "PLAYING" ? "translateY(0)" : "translateY(110%)",
          transition: "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
          pointerEvents: selectedDotUI && gameState === "PLAYING" ? "auto" : "none",
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
                <b>{selectedDotUI.speed}m/s</b>
              </div>
              <div style={{ fontSize: "12px", color: "#333" }}>
                <span style={{ fontSize: "10px", color: "#888", display: "block" }}>Reach</span>
                <b>{selectedDotUI.radius}m</b>
              </div>
              <div style={{ fontSize: "12px", color: "#333" }}>
                <span style={{ fontSize: "10px", color: "#888", display: "block" }}>Sight</span>
                <b>{selectedDotUI.sight}m</b>
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
                +0.5ms⁻¹
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