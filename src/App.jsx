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

function getPixelRadius(map, centerLatLng, meters) {
  if (!map || meters <= 0) return 0;
  const centerPt = map.latLngToLayerPoint(centerLatLng);
  const offsetLatLng = L.latLng(centerLatLng[0] + meters / 111139.0, centerLatLng[1]);
  const offsetPt = map.latLngToLayerPoint(offsetLatLng);
  return Math.hypot(centerPt.x - offsetPt.x, centerPt.y - offsetPt.y);
}

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
  const fogRendererRef = useRef(null);
  const defaultBboxRef = useRef(null);

  const [gameStarted, setGameStarted] = useState(false);
  const gameStartedRef = useRef(false);

  const isZoomingRef = useRef(false);
  const teamZIndexCounter = useRef(1000);

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
      sight: 500,
    }))
  );

  const dotsRef = useRef(
    DOT_CONFIGS.map((cfg, idx) => ({
      id: cfg.id,
      name: cfg.name,
      symbol: cfg.symbol,
      pos: [22.3193, 114.1694],
      state: "Stop",
      speed: 20.0,
      radius: 25,
      sight: 500,
      zIndex: (4 - idx) * 100,
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

  const opponentsRef = useRef([]);

  // Synchronous, zero-flicker fog drawing logic
  const renderFog = () => {
    const fogRenderer = fogRendererRef.current;
    const map = mapRef.current;
    if (!fogRenderer || !fogRenderer._container || !fogRenderer._ctx || !map) return;

    const ctx = fogRenderer._ctx;
    const bounds = fogRenderer._bounds;
    if (!bounds) return;

    const size = bounds.getSize();
    const min = bounds.min;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (L.Browser.retina) {
      ctx.scale(2, 2);
    }
    ctx.translate(-min.x, -min.y);

    ctx.clearRect(min.x, min.y, size.x, size.y);

    if (gameStartedRef.current) {
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
      ctx.fillRect(min.x, min.y, size.x, size.y);

      ctx.globalCompositeOperation = "destination-out";

      dotsRef.current.forEach((dot) => {
        const pt = map.latLngToLayerPoint(dot.pos);
        const innerMeters = Math.max(0, dot.sight - 100);
        const outerMeters = dot.sight + 100;

        const rInner = getPixelRadius(map, dot.pos, innerMeters);
        const rOuter = getPixelRadius(map, dot.pos, outerMeters);

        if (rOuter > 0) {
          const grad = ctx.createRadialGradient(pt.x, pt.y, rInner, pt.x, pt.y, rOuter);
          grad.addColorStop(0, "rgba(0, 0, 0, 1)");
          grad.addColorStop(1, "rgba(0, 0, 0, 0)");

          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, rOuter, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    ctx.restore();
  };

  // 1. Initialize Map, Panes, Team & Opponents
  useEffect(() => {
    if (!mapRef.current) {
      const map = L.map(mapContainerRef.current, {
        minZoom: 11,
        zoomControl: false,
        zoomAnimation: true,
        zoomAnimationDuration: 0.15,
        wheelDebounceTime: 15,
        wheelPxPerZoomLevel: 90,
      }).setView([22.3193, 114.1694], 12);

      // Tile layer with aggressive buffer caching to eliminate raster tile flicker
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        minZoom: 11,
        maxZoom: 19,
        attribution: false,
        keepBuffer: 16, // Keeps 16 rows/cols of tiles cached outside view
        updateWhenIdle: false, // Load continuously
        updateWhenZooming: false,
        updateInterval: 80,
      }).addTo(map);

      // --- CREATION OF STRICT Z-INDEX PANES ---
      // 9. Circle of remaining opponents (zIndex: 300)
      map.createPane("outOfSightOpponentCirclesPane");
      map.getPane("outOfSightOpponentCirclesPane").style.zIndex = 300;

      // 8. Remaining opponents (zIndex: 350)
      map.createPane("outOfSightOpponentsPane");
      map.getPane("outOfSightOpponentsPane").style.zIndex = 350;

      // 7. Fog Pane (zIndex: 400)
      map.createPane("fogPane");
      map.getPane("fogPane").style.zIndex = 400;

      // Broad padding (0.8) so chunk updates happen far outside view
      const fogRenderer = L.canvas({ pane: "fogPane", padding: 0.8 });
      fogRenderer.addTo(map);
      fogRendererRef.current = fogRenderer;

      // CRUCIAL: Hook directly into Leaflet's synchronous _draw step.
      // Whenever Leaflet resizes the canvas for a new chunk, it calls _draw synchronously
      // before the frame is painted to the display, eliminating the blank flicker completely!
      fogRenderer._draw = () => {
        renderFog();
      };

      // 6. Circle of opponents within sight (zIndex: 450)
      map.createPane("inSightOpponentCirclesPane");
      map.getPane("inSightOpponentCirclesPane").style.zIndex = 450;

      // 5. Circle of team members (zIndex: 500)
      map.createPane("teamCirclesPane");
      map.getPane("teamCirclesPane").style.zIndex = 500;

      // 4. Path routes (zIndex: 550)
      map.createPane("pathsPane");
      map.getPane("pathsPane").style.zIndex = 550;

      // 3. All opponents within sight (zIndex: 600)
      map.createPane("inSightOpponentsPane");
      map.getPane("inSightOpponentsPane").style.zIndex = 600;

      // 2. All team members (zIndex: 650)
      map.createPane("teamMembersPane");
      map.getPane("teamMembersPane").style.zIndex = 650;

      const teamCirclesRenderer = L.canvas({ padding: 0.8, pane: "teamCirclesPane" });
      const pathsRenderer = L.canvas({ padding: 0.8, pane: "pathsPane" });
      const inSightCirclesRenderer = L.canvas({ padding: 0.8, pane: "inSightOpponentCirclesPane" });
      const outOfSightCirclesRenderer = L.canvas({ padding: 0.8, pane: "outOfSightOpponentCirclesPane" });

      dotsRef.current.forEach((dot) => {
        const dotOuter = L.circle(dot.pos, {
          renderer: teamCirclesRenderer,
          pane: "teamCirclesPane",
          radius: dot.radius,
          color: OUR_TEAM_COLOR,
          weight: 1,
          fillColor: OUR_TEAM_COLOR,
          fillOpacity: 0.25,
          interactive: false,
        }).addTo(map);

        const dotEmoji = L.marker(dot.pos, {
          icon: getPrebakedEmojiIcon(dot.symbol, OUR_TEAM_COLOR, false, 1.0),
          pane: "teamMembersPane",
          zIndexOffset: dot.zIndex,
          interactive: false,
        }).addTo(map);

        const landPath = L.polyline([], {
          renderer: pathsRenderer,
          pane: "pathsPane",
          color: "#1e824c",
          weight: 5,
          opacity: 0.55,
          interactive: false,
        }).addTo(map);

        const waterPath = L.polyline([], {
          renderer: pathsRenderer,
          pane: "pathsPane",
          color: "#0077be",
          weight: 5,
          opacity: 0.55,
          interactive: false,
        }).addTo(map);

        const hollowDest = L.circle([0, 0], {
          renderer: teamCirclesRenderer,
          pane: "teamCirclesPane",
          radius: 15,
          color: OUR_TEAM_COLOR,
          weight: 2,
          dashArray: "6, 6",
          fill: false,
          interactive: false,
        }).addTo(map);

        dot.layers = { dotOuter, dotEmoji, landPath, waterPath, hollowDest };
      });

      // Zoom lifecycle events
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

        renderFog();
      });

      mapRef.current = map;

      initGraph()
        .then(async ({ bbox }) => {
          defaultBboxRef.current = bbox;
          map.fitBounds(bbox);

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
          opponentsRef.current = opponentUnits.map(({ pt, symbol, teamColor }) => {
            const circleInSight = L.circle(pt, {
              renderer: inSightCirclesRenderer,
              pane: "inSightOpponentCirclesPane",
              radius: 25,
              color: teamColor,
              weight: 1,
              opacity: 0,
              fillColor: teamColor,
              fillOpacity: 0,
              interactive: false,
            }).addTo(map);

            const circleOutOfSight = L.circle(pt, {
              renderer: outOfSightCirclesRenderer,
              pane: "outOfSightOpponentCirclesPane",
              radius: 25,
              color: teamColor,
              weight: 1,
              opacity: 0.5,
              fillColor: teamColor,
              fillOpacity: 0.125,
              interactive: false,
            }).addTo(map);

            const marker = L.marker(pt, {
              icon: getPrebakedEmojiIcon(symbol, teamColor, false, 1.0),
              pane: "outOfSightOpponentsPane",
              interactive: false,
            }).addTo(map);

            return {
              pos: pt,
              symbol,
              teamColor,
              circleInSight,
              circleOutOfSight,
              marker,
            };
          });
        })
        .catch((err) => console.error("Init Error:", err));
    }
  }, []);

  // 2. High-Performance Movement, Scaling & Synchronous Fog Loop (60 FPS)
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

      const isStarted = gameStartedRef.current;

      // 1. Team Movement
      if (isStarted) {
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

            if (!isZooming) {
              layers.dotOuter.setLatLng(dot.pos);
              layers.dotEmoji.setLatLng(dot.pos);

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
      }

      // 2. Opponent Dynamics & Pane/Z-Index Sorting
      if (map && opponentsRef.current.length > 0) {
        const teamMembers = dotsRef.current;

        opponentsRef.current.forEach((opp) => {
          if (!isStarted) {
            if (opp.marker && opp.marker._icon) {
              opp.marker._icon.style.width = "40px";
              opp.marker._icon.style.height = "40px";
              opp.marker._icon.style.marginLeft = "-20px";
              opp.marker._icon.style.marginTop = "-20px";
            }
            return;
          }

          let minT = Infinity;
          let inSight = false;

          for (let m = 0; m < teamMembers.length; m++) {
            const member = teamMembers[m];
            const dist = haversineMeters(member.pos[0], member.pos[1], opp.pos[0], opp.pos[1]);
            if (dist <= member.sight) {
              inSight = true;
            }
            const s = Math.max(0.1, member.speed);
            const t = dist / s;
            if (t < minT) minT = t;
          }

          let scale = 1.0;
          if (minT <= 5) {
            scale = 1.0;
          } else if (minT >= 60) {
            scale = 0.4;
          } else {
            scale = 1.0 - 0.6 * ((minT - 5) / 55.0);
          }

          if (opp.marker && opp.marker._icon) {
            const size = Math.round(40 * scale);
            const half = Math.round(size / 2);
            opp.marker._icon.style.width = `${size}px`;
            opp.marker._icon.style.height = `${size}px`;
            opp.marker._icon.style.marginLeft = `-${half}px`;
            opp.marker._icon.style.marginTop = `-${half}px`;

            const targetPaneName = inSight ? "inSightOpponentsPane" : "outOfSightOpponentsPane";
            const targetPaneElem = map.getPane(targetPaneName);
            if (targetPaneElem && opp.marker._icon.parentNode !== targetPaneElem) {
              targetPaneElem.appendChild(opp.marker._icon);
            }

            if (inSight) {
              const zOffset = Math.round(10000 - Math.min(10000, minT * 100));
              opp.marker.setZIndexOffset(zOffset);
            } else {
              opp.marker.setZIndexOffset(0);
            }
          }

          if (inSight) {
            opp.circleInSight.setStyle({ opacity: 0.5, fillOpacity: 0.125 });
            opp.circleOutOfSight.setStyle({ opacity: 0, fillOpacity: 0 });
          } else {
            opp.circleInSight.setStyle({ opacity: 0, fillOpacity: 0 });
            opp.circleOutOfSight.setStyle({ opacity: 0.5, fillOpacity: 0.125 });
          }
        });
      }

      // 3. Render Fog during animation (if not zoom animating)
      if (!isZooming) {
        renderFog();
      }

      // UI Sync
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

  // 3. Selection & Dynamic Team Member zIndex
  const handleToggleSelect = (id) => {
    if (!gameStartedRef.current) return;
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

        teamZIndexCounter.current += 10;
        dot.zIndex = teamZIndexCounter.current;
        if (dot.layers.dotEmoji) {
          dot.layers.dotEmoji.setZIndexOffset(dot.zIndex);
        }
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

  // 4. Targeted Map Click Rerouting (Blocked before game starts)
  useEffect(() => {
    if (!mapRef.current) return;

    const onMapClick = async (e) => {
      if (!gameStartedRef.current) return;

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

  // --- START GAME HANDLER ---
  const handleStartGame = () => {
    gameStartedRef.current = true;
    setGameStarted(true);
    renderFog();
  };

  // --- BUTTON HANDLERS ---
  const handleAddSpeed = (id, e) => {
    e.stopPropagation();
    if (!gameStartedRef.current) return;
    const dot = dotsRef.current[id];
    if (dot) dot.speed += 5.0;
  };

  const handleAddRadius = (id, e) => {
    e.stopPropagation();
    if (!gameStartedRef.current) return;
    const dot = dotsRef.current[id];
    if (dot) {
      dot.radius += 10;
      if (dot.layers.dotOuter) dot.layers.dotOuter.setRadius(dot.radius);
    }
  };

  const handleAddSight = (id, e) => {
    e.stopPropagation();
    if (!gameStartedRef.current) return;
    const dot = dotsRef.current[id];
    if (dot) dot.sight += 50;
  };

  const handleTeleport = (id, e) => {
    e.stopPropagation();
    if (!gameStartedRef.current) return;
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
  };

  const selectedDotUI = dotsUI.find((d) => d.id === selectedId);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        margin: 0,
        padding: 0,
        overflow: "hidden",
      }}
    >
      {/* 1. White Round Start Game Button on Top-Left (zIndex: 1100) */}
      {!gameStarted && (
        <button
          onClick={handleStartGame}
          title="Start Game"
          style={{
            position: "absolute",
            top: 20,
            left: 20,
            zIndex: 1100,
            width: "52px",
            height: "52px",
            borderRadius: "50%",
            backgroundColor: "#ffffff",
            border: "none",
            boxShadow: "0 4px 14px rgba(0, 0, 0, 0.25)",
            fontSize: "24px",
            color: "#111",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            userSelect: "none",
            outline: "none",
            transition: "transform 0.15s ease",
          }}
          onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.92)")}
          onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
        >
          ▷
        </button>
      )}

      {/* 4 White Circle Buttons on Bottom-Left in a Vertical Line (zIndex: 1000) */}
      <div
        style={{
          position: "absolute",
          bottom: 20,
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

      {/* Slide-Up Popup Panel (zIndex: 1000) */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 76,
          right: 0,
          zIndex: 1000,
          backgroundColor: "rgba(255, 255, 255, 0.95)",
          backdropFilter: "blur(8px)",
          boxShadow: "0 -4px 16px rgba(0, 0, 0, 0.15)",
          borderTop: "1.5px solid #e0e0e0",
          borderTopLeftRadius: "16px",
          padding: "12px 18px 24px",
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
                <span style={{ fontSize: "10px", color: "#888", display: "block" }}>Radius</span>
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
                  background: "#ffc107",
                  color: "#000",
                  border: "none",
                  borderRadius: "14px",
                  fontSize: "11px",
                  fontWeight: "bold",
                  cursor: "pointer",
                }}
              >
                +50m
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