// App.js
import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { initGraph, snap, pathfind } from "./fetch";

const TEAM_COLORS = [
  "#D50000", // 1. Crimson Red (Our Team)
  "#FF5500", // 2. Blaze Orange
  "#C87800", // 3. Amber Gold
  "#008828", // 4. Kelly Green
  "#5EA800", // 5. Lime Chartreuse
  "#0088D6", // 6. Cerulean Cyan
  "#002BFF", // 7. Cobalt Blue
  "#5500FF", // 8. Electric Indigo
  "#FF1464", // 9. Hot Pink
  "#7B3800", // 10. Burnt Rust / Terracotta
  "#66002A", // 11. Deep Wine / Burgundy
  "#003866", // 12. Midnight Teal / Petrol
];

const OUR_TEAM_COLOR = TEAM_COLORS[0];

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

function getMetersToPixels(map, lat, meters) {
  const latRad = lat * (Math.PI / 180);
  const metersPerPx = (40075016.686 * Math.cos(latRad)) / (256 * Math.pow(2, map.getZoom()));
  return meters / metersPerPx;
}

// In-memory icon texture cache
const iconTextureCache = new Map();

function getPrebakedEmojiIcon(symbol, color = OUR_TEAM_COLOR, isStrongGlow = false, opacity = 1.0) {
  const cacheKey = `${symbol}_${color}_${isStrongGlow}_${opacity}`;
  if (iconTextureCache.has(cacheKey)) {
    return iconTextureCache.get(cacheKey);
  }

  const displaySize = isStrongGlow ? 48 : 40;
  const scale = 2;
  const canvasSize = displaySize * scale;

  const canvas = document.createElement("canvas");
  canvas.width = canvasSize;
  canvas.height = canvasSize;
  const ctx = canvas.getContext("2d");

  const center = canvasSize / 2;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const fontSize = isStrongGlow ? 22 * scale : 19 * scale;
  ctx.font = `${fontSize}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;

  if (isStrongGlow) {
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 18 * scale;
    ctx.fillText(symbol, center, center);

    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 10 * scale;
    ctx.fillText(symbol, center, center);

    ctx.shadowColor = color;
    ctx.shadowBlur = 6 * scale;
    ctx.fillText(symbol, center, center);
    ctx.fillText(symbol, center, center);
  } else {
    ctx.shadowColor = color;
    ctx.shadowBlur = 12 * scale;
    ctx.fillText(symbol, center, center);

    ctx.shadowBlur = 6 * scale;
    ctx.fillText(symbol, center, center);

    ctx.shadowBlur = 3 * scale;
    ctx.fillText(symbol, center, center);
  }

  ctx.shadowBlur = 0;
  ctx.fillText(symbol, center, center);
  ctx.restore();

  const icon = L.icon({
    iconUrl: canvas.toDataURL("image/png"),
    iconSize: [displaySize, displaySize],
    iconAnchor: [displaySize / 2, displaySize / 2],
  });

  iconTextureCache.set(cacheKey, icon);
  return icon;
}

function buildPathSegments(dot) {
  const { pos, waypoints, waterFlags, segIdx } = dot;
  if (!waypoints || waypoints.length <= 1 || segIdx >= waypoints.length - 1) {
    return { landMulti: [], waterMulti: [] };
  }

  const landMulti = [];
  const waterMulti = [];

  let currentType = waterFlags[segIdx] === 1 ? "water" : "land";
  let currentChunk = [pos, waypoints[segIdx + 1]];

  for (let i = segIdx + 1; i < waypoints.length - 1; i++) {
    const segType = waterFlags[i] === 1 ? "water" : "land";
    const nextPt = waypoints[i + 1];

    if (segType === currentType) {
      currentChunk.push(nextPt);
    } else {
      if (currentType === "water") {
        waterMulti.push(currentChunk);
      } else {
        landMulti.push(currentChunk);
      }
      currentType = segType;
      currentChunk = [waypoints[i], nextPt];
    }
  }

  if (currentChunk.length > 1) {
    if (currentType === "water") {
      waterMulti.push(currentChunk);
    } else {
      landMulti.push(currentChunk);
    }
  }

  return { landMulti, waterMulti };
}

export default function App() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const defaultBboxRef = useRef(null);
  const fogCanvasRef = useRef(null);

  const isZoomingRef = useRef(false);

  // Selected State
  const [selectedId, setSelectedId] = useState(null);
  const selectedIdRef = useRef(null);

  // Reactive UI state
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
    }))
  );

  // Engine state for 60fps tracking
  const dotsRef = useRef(
    DOT_CONFIGS.map((cfg) => ({
      id: cfg.id,
      name: cfg.name,
      symbol: cfg.symbol,
      pos: [22.3193, 114.1694],
      state: "Stop",
      speed: 20.0,
      radius: 25,
      waypoints: [],
      waterFlags: [],
      segIdx: 0,
      nextAllowedClick: 0,
      redirectStart: 0,
      ferryTarget: null,
      distLeft: "--",
      layers: {
        dotOuter: null,
        dotEmoji: null,
        landPath: null,
        waterPath: null,
        hollowDest: null,
      },
    }))
  );

  // High-performance 2D Canvas Fog Renderer: 400m solid bright -> 600m solid dark
  const drawFog = () => {
    const map = mapRef.current;
    const canvas = fogCanvasRef.current;
    if (!map || !canvas) return;

    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;

    // 1. Fill entire canvas with dark tactical military tone
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(7, 14, 23, 0.72)";
    ctx.fillRect(0, 0, width, height);

    // 2. Punch out holes using destination-out
    ctx.globalCompositeOperation = "destination-out";

    dotsRef.current.forEach((dot) => {
      // Container point aligns 1:1 with canvas pixels because canvas dimensions match map.getSize()
      const pt = map.latLngToContainerPoint(dot.pos);
      const r400 = getMetersToPixels(map, dot.pos[0], 400);
      const r600 = getMetersToPixels(map, dot.pos[0], 600);

      if (r600 <= 0) return;

      // Inner 400m: 100% erased (bright daylight)
      ctx.fillStyle = "rgba(0, 0, 0, 1)";
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, Math.max(0, r400), 0, Math.PI * 2);
      ctx.fill();

      // 400m to 600m: Smooth gradient transition dissolve
      const grad = ctx.createRadialGradient(pt.x, pt.y, Math.max(0, r400), pt.x, pt.y, r600);
      grad.addColorStop(0, "rgba(0, 0, 0, 1)");
      grad.addColorStop(1, "rgba(0, 0, 0, 0)");

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r600, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.globalCompositeOperation = "source-over";
  };

  // Sync canvas buffer pixels directly to Leaflet container size to prevent mobile offset
  const syncCanvasSize = () => {
    const map = mapRef.current;
    const canvas = fogCanvasRef.current;
    if (!map || !canvas) return;

    const size = map.getSize();
    if (canvas.width !== size.x || canvas.height !== size.y) {
      canvas.width = size.x;
      canvas.height = size.y;
    }
    drawFog();
  };

  // 1. Initialize Map, Player Team & Opponents
  useEffect(() => {
    if (!mapRef.current) {
      const map = L.map(mapContainerRef.current, {
        minZoom: 10,
        zoomControl: false,
        zoomAnimation: true,
        zoomAnimationDuration: 0.15,
        wheelDebounceTime: 15,
        wheelPxPerZoomLevel: 90,
      }).setView([22.3193, 114.1694], 12);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        minZoom: 10,
        maxZoom: 19,
        attribution: "© OpenStreetMap",
      }).addTo(map);

      const canvasRenderer = L.canvas({ padding: 0.5 });

      // Controllable Player Units (Crimson Red)
      dotsRef.current.forEach((dot) => {
        const dotOuter = L.circle(dot.pos, {
          renderer: canvasRenderer,
          radius: dot.radius,
          color: OUR_TEAM_COLOR,
          weight: 1,
          fillColor: OUR_TEAM_COLOR,
          fillOpacity: 0.25,
          interactive: false,
        }).addTo(map);

        const dotEmoji = L.marker(dot.pos, {
          icon: getPrebakedEmojiIcon(dot.symbol, OUR_TEAM_COLOR, false, 1.0),
          interactive: false,
        }).addTo(map);

        const landPath = L.polyline([], {
          renderer: canvasRenderer,
          color: "#1e824c",
          weight: 5,
          opacity: 0.55,
          interactive: false,
        }).addTo(map);

        const waterPath = L.polyline([], {
          renderer: canvasRenderer,
          color: "#0077be",
          weight: 5,
          opacity: 0.55,
          interactive: false,
        }).addTo(map);

        const hollowDest = L.circle([0, 0], {
          renderer: canvasRenderer,
          radius: 15,
          color: OUR_TEAM_COLOR,
          weight: 2,
          dashArray: "6, 6",
          fill: false,
          interactive: false,
        }).addTo(map);

        dot.layers = { dotOuter, dotEmoji, landPath, waterPath, hollowDest };
      });

      // Handle dynamic mobile navigation bar collapsing/expanding
      const handleViewportResize = () => {
        map.invalidateSize({ animate: false });
        syncCanvasSize();
      };

      window.addEventListener("resize", handleViewportResize);
      if (window.visualViewport) {
        window.visualViewport.addEventListener("resize", handleViewportResize);
      }

      // Initial buffer calibration
      syncCanvasSize();

      // Keep fog attached to the map continuously during zoom and pan
      map.on("zoom", drawFog);
      map.on("move", drawFog);

      map.on("zoomstart", () => {
        isZoomingRef.current = true;
      });

      map.on("zoomend", () => {
        isZoomingRef.current = false;
        dotsRef.current.forEach((dot) => {
          dot.layers.dotOuter.setLatLng(dot.pos);
          dot.layers.dotEmoji.setLatLng(dot.pos);

          const { landMulti, waterMulti } = buildPathSegments(dot);
          dot.layers.landPath.setLatLngs(landMulti);
          dot.layers.waterPath.setLatLngs(waterMulti);
        });
        syncCanvasSize();
      });

      mapRef.current = map;

      // Scatter player and 44 opponents asynchronously
      initGraph()
        .then(async ({ bbox }) => {
          defaultBboxRef.current = bbox;
          map.fitBounds(bbox);

          // 1. Scatter our 4 controllable characters
          const playerSnapPromises = dotsRef.current.map(() => {
            const randLat = bbox[0][0] + Math.random() * (bbox[1][0] - bbox[0][0]);
            const randLon = bbox[0][1] + Math.random() * (bbox[1][1] - bbox[0][1]);
            return snap(randLat, randLon);
          });

          const playerSnaps = await Promise.all(playerSnapPromises);
          playerSnaps.forEach((res, i) => {
            const dot = dotsRef.current[i];
            dot.pos = res.pt;
            dot.layers.dotOuter.setLatLng(res.pt);
            dot.layers.dotEmoji.setLatLng(res.pt);
          });

          syncCanvasSize();

          // 2. Scatter remaining 44 characters (Teams 2 to 12)
          const opponentPromises = [];
          for (let teamIdx = 1; teamIdx < TEAM_COLORS.length; teamIdx++) {
            const teamColor = TEAM_COLORS[teamIdx];
            DOT_CONFIGS.forEach((cfg) => {
              const randLat = bbox[0][0] + Math.random() * (bbox[1][0] - bbox[0][0]);
              const randLon = bbox[0][1] + Math.random() * (bbox[1][1] - bbox[0][1]);
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
          opponentUnits.forEach(({ pt, symbol, teamColor }) => {
            L.circle(pt, {
              renderer: canvasRenderer,
              radius: 25,
              color: teamColor,
              weight: 1,
              opacity: 0.5,
              fillColor: teamColor,
              fillOpacity: 0.125,
              interactive: false,
            }).addTo(map);

            L.marker(pt, {
              icon: getPrebakedEmojiIcon(symbol, teamColor, false, 0.5),
              interactive: false,
            }).addTo(map);
          });
        })
        .catch((err) => console.error("Init Error:", err));

      return () => {
        window.removeEventListener("resize", handleViewportResize);
        if (window.visualViewport) {
          window.visualViewport.removeEventListener("resize", handleViewportResize);
        }
      };
    }
  }, []);

  // 2. High-Performance Movement Engine (60 FPS)
  useEffect(() => {
    let animId;
    let lastTime = performance.now();
    let lastUIUpdate = 0;

    const loop = (now) => {
      const dt = (now - lastTime) / 1000.0;
      lastTime = now;

      const map = mapRef.current;
      const isZooming =
        isZoomingRef.current ||
        Boolean(map && (map._animatingZoom || map._zooming || (map.touchZoom && map.touchZoom._zooming)));

      dotsRef.current.forEach((dot) => {
        const { state, waypoints, layers } = dot;
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

          layers.dotEmoji.setLatLng(dot.pos);

          if (!isZooming) {
            layers.dotOuter.setLatLng(dot.pos);
            const { landMulti, waterMulti } = buildPathSegments(dot);
            layers.landPath.setLatLngs(landMulti);
            layers.waterPath.setLatLngs(waterMulti);
          }

          if (state !== "Redirecting") {
            const isWater = dot.waterFlags[segIdx] === 1;
            dot.state = isWater ? "Ferry" : "Move";
          }

          if (segIdx >= waypoints.length - 1) {
            dot.state = "Stop";
            dot.waypoints = [];
            layers.landPath.setLatLngs([]);
            layers.waterPath.setLatLngs([]);
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

      // Continuously redraw fog vision holes along moving units
      drawFog();

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
          }))
        );
        lastUIUpdate = now;
      }

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, []);

  // 3. Selection & Glowing Control
  const handleToggleSelect = (id) => {
    const map = mapRef.current;
    if (!map) return;

    let nextSelectedId = null;

    if (selectedIdRef.current === id) {
      selectedIdRef.current = null;
      setSelectedId(null);
    } else {
      nextSelectedId = id;
      selectedIdRef.current = id;
      setSelectedId(id);
      const dot = dotsRef.current[id];
      if (dot) {
        map.panTo(dot.pos, { animate: true, duration: 0.6 });
      }
    }

    dotsRef.current.forEach((d) => {
      if (d.layers.dotEmoji) {
        d.layers.dotEmoji.setIcon(
          getPrebakedEmojiIcon(d.symbol, OUR_TEAM_COLOR, d.id === nextSelectedId, 1.0)
        );
      }
    });
  };

  // 4. Targeted Map Click Rerouting
  useEffect(() => {
    if (!mapRef.current) return;

    const onMapClick = async (e) => {
      const activeId = selectedIdRef.current;
      if (activeId === null) return;

      const dot = dotsRef.current[activeId];
      const now = performance.now();

      if (now < dot.nextAllowedClick || dot.state === "Redirecting") return;

      const { lat: clickLat, lng: clickLon } = e.latlng;
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
        dot.layers.hollowDest.setLatLng(snapC.pt);

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

        const { landMulti, waterMulti } = buildPathSegments(dot);
        dot.layers.landPath.setLatLngs(landMulti);
        dot.layers.waterPath.setLatLngs(waterMulti);

        dot.nextAllowedClick = performance.now() + 200;
        dot.state = newFlags[0] === 1 ? "Ferry" : "Move";
      } else {
        dot.state = "Redirecting";

        const startPos = dot.pos;
        const snapC = await snap(clickLat, clickLon);
        dot.layers.hollowDest.setLatLng(snapC.pt);

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

        dot.layers.dotOuter.setLatLng(dot.pos);
        dot.layers.dotEmoji.setLatLng(dot.pos);

        const { landMulti, waterMulti } = buildPathSegments(dot);
        dot.layers.landPath.setLatLngs(landMulti);
        dot.layers.waterPath.setLatLngs(waterMulti);

        dot.nextAllowedClick = performance.now() + 200;
        dot.state = waterFlags[0] === 1 ? "Ferry" : "Move";
      }
    };

    const map = mapRef.current;
    map.on("click", onMapClick);
    return () => map.off("click", onMapClick);
  }, []);

  // --- BUTTON HANDLERS ---
  const handleAddSpeed = (id, e) => {
    e.stopPropagation();
    const dot = dotsRef.current[id];
    if (dot) dot.speed += 5.0;
  };

  const handleAddRadius = (id, e) => {
    e.stopPropagation();
    const dot = dotsRef.current[id];
    if (dot) {
      dot.radius += 10;
      if (dot.layers.dotOuter) dot.layers.dotOuter.setRadius(dot.radius);
    }
  };

  const handleTeleport = (id, e) => {
    e.stopPropagation();
    const dot = dotsRef.current[id];
    if (!dot || !dot.waypoints || dot.waypoints.length === 0) return;

    const destCoord = dot.waypoints[dot.waypoints.length - 1];
    dot.pos = destCoord;

    if (dot.layers.dotOuter) dot.layers.dotOuter.setLatLng(destCoord);
    if (dot.layers.dotEmoji) dot.layers.dotEmoji.setLatLng(destCoord);
    if (dot.layers.landPath) dot.layers.landPath.setLatLngs([]);
    if (dot.layers.waterPath) dot.layers.waterPath.setLatLngs([]);

    dot.waypoints = [];
    dot.waterFlags = [];
    dot.segIdx = 0;
    dot.ferryTarget = null;
    dot.state = "Stop";
    dot.timeLeft = "--";
    dot.eta = "--";
    dot.distLeft = "--";

    drawFog();
  };

  const selectedDotUI = dotsUI.find((d) => d.id === selectedId);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        width: "100dvw",
        height: "100vh",
        height: "100dvh", // Automatically tracks mobile dynamic URL bar and bottom nav
        margin: 0,
        padding: 0,
        overflow: "hidden",
        overscrollBehavior: "none", // Prevents mobile pull-to-refresh & rubber-banding
      }}
    >
      {/* 
        High-Performance 2D Canvas Fog of War Layer (zIndex: 450)
        - Locked to map.getSize() so the hole is perfectly centered on the emoji on mobile
        - Redrawn continuously across zoom and pan
      */}
      <canvas
        ref={fogCanvasRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          zIndex: 450,
        }}
      />

      {/* 4 White Circle Buttons on Bottom-Left in a Vertical Line */}
      <div
        style={{
          position: "absolute",
          bottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
          left: 16,
          zIndex: 1000,
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

      {/* Slide-Up Popup Panel (Connected to Bottom, accommodates safe area on iPhone) */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 76,
          right: 0,
          zIndex: 999,
          backgroundColor: "rgba(255, 255, 255, 0.95)",
          backdropFilter: "blur(8px)",
          boxShadow: "0 -4px 16px rgba(0, 0, 0, 0.15)",
          borderTop: "1.5px solid #e0e0e0",
          borderTopLeftRadius: "16px",
          padding: "12px 18px",
          paddingBottom: "max(12px, env(safe-area-inset-bottom))",
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
            {/* Identity & State */}
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

            {/* Telemetry Stats */}
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
                <span style={{ fontSize: "10px", color: "#888", display: "block" }}>Radius</span>
                <b>{selectedDotUI.radius} m</b>
              </div>
            </div>

            {/* Actions: Modifiers & Hide Button */}
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

      <div ref={mapContainerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}