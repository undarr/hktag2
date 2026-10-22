// App.jsx
import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { initGraph, snap, pathfind } from "./fetch";

const DOT_CONFIGS = [
  { id: 0, symbol: "👮", name: "Officer" },
  { id: 1, symbol: "🚔", name: "Cruiser" },
  { id: 2, symbol: "🚁", name: "Chopper" },
  { id: 3, symbol: "🏃", name: "Runner" },
];

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

export default function App() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const defaultBboxRef = useRef(null);

  // Selected Bubble State
  const [selectedId, setSelectedId] = useState(null);
  const selectedIdRef = useRef(null);

  // Reactive UI state for all 4 dots (throttled for 60fps performance)
  const [dotsUI, setDotsUI] = useState(
    DOT_CONFIGS.map((cfg) => ({
      id: cfg.id,
      symbol: cfg.symbol,
      state: "Stop",
      eta: "--",
      timeLeft: "--",
      speed: 20.0,
      radius: 25,
    }))
  );

  // Engine state for all 4 dots kept in refs for high-speed animation
  const dotsRef = useRef(
    DOT_CONFIGS.map((cfg) => ({
      id: cfg.id,
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
      layers: {
        dotOuter: null,
        dotInner: null,
        dotEmoji: null,
        activePath: null,
        hollowDest: null,
      },
    }))
  );

  // 1. Initialize Map and the 4 Dots
  useEffect(() => {
    if (!mapRef.current) {
      const map = L.map(mapContainerRef.current, {
        zoomAnimation: true,
        zoomAnimationDuration: 0.15,
        wheelDebounceTime: 15,
        wheelPxPerZoomLevel: 90,
      }).setView([22.3193, 114.1694], 12);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap",
      }).addTo(map);

      const vectorRenderer = L.svg({ padding: 0.1 });

      // Create layers for each of the 4 dots
      dotsRef.current.forEach((dot) => {
        // Outer 25m transparent red disk
        const dotOuter = L.circle(dot.pos, {
          renderer: vectorRenderer,
          radius: dot.radius,
          color: "#ff0000",
          weight: 1,
          fillColor: "#ff0000",
          fillOpacity: 0.25,
        }).addTo(map);

        // Inner 7.5m bold red circle
        const dotInner = L.circle(dot.pos, {
          renderer: vectorRenderer,
          radius: 7.5,
          color: "#990000",
          weight: 3,
          fillColor: "#ff0000",
          fillOpacity: 1.0,
        }).addTo(map);

        // Emoji label centered on the bold dot
        const dotEmoji = L.marker(dot.pos, {
          icon: L.divIcon({
            className: "dot-emoji-icon",
            html: `<div style="font-size: 13px; line-height: 13px; text-align: center; user-select: none;">${dot.symbol}</div>`,
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          }),
          interactive: false,
        }).addTo(map);

        // Transparent non-dashed path line
        const activePath = L.polyline([], {
          renderer: vectorRenderer,
          color: "#ff0000",
          weight: 5,
          opacity: 0.45,
        }).addTo(map);

        // Dashed hollow destination circle
        const hollowDest = L.circle([0, 0], {
          renderer: vectorRenderer,
          radius: 15,
          color: "#ff0000",
          weight: 2,
          dashArray: "6, 6",
          fill: false,
        }).addTo(map);

        dot.layers = { dotOuter, dotInner, dotEmoji, activePath, hollowDest };
      });

      mapRef.current = map;

      // Clean refresh of all paths on zoom
      map.on("zoomend", () => {
        dotsRef.current.forEach((dot) => {
          if (dot.waypoints.length > 0) {
            const remaining = [dot.pos, ...dot.waypoints.slice(dot.segIdx + 1)];
            dot.layers.activePath.setLatLngs(remaining);
          }
        });
      });

      // Load graph & scatter dots across 4 random land nodes
      initGraph()
        .then(async ({ bbox }) => {
          defaultBboxRef.current = bbox;
          map.fitBounds(bbox);

          for (let i = 0; i < 4; i++) {
            const randLat = bbox[0][0] + Math.random() * (bbox[1][0] - bbox[0][0]);
            const randLon = bbox[0][1] + Math.random() * (bbox[1][1] - bbox[0][1]);
            const initialSnap = await snap(randLat, randLon);

            const dot = dotsRef.current[i];
            dot.pos = initialSnap.pt;
            dot.layers.dotOuter.setLatLng(initialSnap.pt);
            dot.layers.dotInner.setLatLng(initialSnap.pt);
            dot.layers.dotEmoji.setLatLng(initialSnap.pt);
          }
        })
        .catch((err) => console.error("Init Error:", err));
    }
  }, []);

  // 2. High-Performance Movement Engine for All 4 Dots (60 FPS)
  useEffect(() => {
    let animId;
    let lastTime = performance.now();
    let lastUIUpdate = 0;

    const loop = (now) => {
      const dt = (now - lastTime) / 1000.0;
      lastTime = now;

      const map = mapRef.current;
      const isZooming = map && (map._animatingZoom || map._zooming);

      dotsRef.current.forEach((dot) => {
        const { state, waypoints, flags = dot.waterFlags, layers } = dot;
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
            layers.dotInner.setLatLng(dot.pos);
            layers.dotEmoji.setLatLng(dot.pos);

            const remaining = [dot.pos, ...waypoints.slice(segIdx + 1)];
            layers.activePath.setLatLngs(remaining);
          }

          if (state !== "Redirecting") {
            const isWater = dot.waterFlags[segIdx] === 1;
            dot.state = isWater ? "Ferry" : "Move";
          }

          if (segIdx >= waypoints.length - 1) {
            dot.state = "Stop";
            dot.waypoints = [];
            layers.activePath.setLatLngs([]);
            dot.timeLeft = "--";
            dot.eta = "--";
          } else {
            let remDist = haversineMeters(dot.pos[0], dot.pos[1], waypoints[segIdx + 1][0], waypoints[segIdx + 1][1]);
            for (let i = segIdx + 1; i < waypoints.length - 1; i++) {
              remDist += haversineMeters(waypoints[i][0], waypoints[i][1], waypoints[i + 1][0], waypoints[i + 1][1]);
            }
            const remSec = remDist / dot.speed;
            dot.timeLeft = remSec.toFixed(1) + "s";
            const etaDate = new Date(Date.now() + remSec * 1000);
            dot.eta = etaDate.toLocaleTimeString([], { hour12: false });
          }
        }
      });

      // Synchronize UI every 100ms
      if (now - lastUIUpdate > 100) {
        setDotsUI(
          dotsRef.current.map((d) => ({
            id: d.id,
            symbol: d.symbol,
            state: d.state,
            eta: d.eta,
            timeLeft: d.timeLeft,
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

  // 3. Selection & Camera Panning Logic
  const handleToggleSelect = (id) => {
    const map = mapRef.current;
    if (!map) return;

    if (selectedIdRef.current === id) {
      // Deselect: pan back out to default graph bounds
      selectedIdRef.current = null;
      setSelectedId(null);
      if (defaultBboxRef.current) {
        map.fitBounds(defaultBboxRef.current, { animate: true, duration: 0.7 });
      }
    } else {
      // Select: pan to the selected dot
      selectedIdRef.current = id;
      setSelectedId(id);
      const dot = dotsRef.current[id];
      if (dot) {
        map.panTo(dot.pos, { animate: true, duration: 0.6 });
      }
    }
  };

  // 4. Targeted Map Click Rerouting (Redirects only the selected dot)
  useEffect(() => {
    if (!mapRef.current) return;

    const onMapClick = async (e) => {
      const activeId = selectedIdRef.current;
      if (activeId === null) return; // Do nothing if no bubble is selected

      const dot = dotsRef.current[activeId];
      const now = performance.now();

      // 0.2s anti-spam rule
      if (now < dot.nextAllowedClick || dot.state === "Redirecting") return;

      const { lat: clickLat, lng: clickLon } = e.latlng;
      const curState = dot.state;
      const waypoints = dot.waypoints;
      const flags = dot.waterFlags;
      const curSeg = dot.segIdx;

      dot.redirectStart = performance.now();

      // --- Scenario A: Selected dot is on Ferry ---
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

        dot.layers.activePath.setLatLngs(newWaypoints);
        dot.nextAllowedClick = performance.now() + 200;
        dot.state = newFlags[0] === 1 ? "Ferry" : "Move";
      }
      // --- Scenario B: Selected dot is in Move or Stop ---
      else {
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
        dot.layers.dotInner.setLatLng(dot.pos);
        dot.layers.dotEmoji.setLatLng(dot.pos);
        dot.layers.activePath.setLatLngs(newWaypoints);

        dot.nextAllowedClick = performance.now() + 200;
        dot.state = waterFlags[0] === 1 ? "Ferry" : "Move";
      }
    };

    const map = mapRef.current;
    map.on("click", onMapClick);
    return () => map.off("click", onMapClick);
  }, []);

  // --- BUTTON HANDLERS (Operate on individual dot) ---
  const handleAddSpeed = (id, e) => {
    e.stopPropagation();
    const dot = dotsRef.current[id];
    dot.speed += 5.0;
  };

  const handleAddRadius = (id, e) => {
    e.stopPropagation();
    const dot = dotsRef.current[id];
    dot.radius += 10;
    if (dot.layers.dotOuter) dot.layers.dotOuter.setRadius(dot.radius);
  };

  const handleTeleport = (id, e) => {
    e.stopPropagation();
    const dot = dotsRef.current[id];
    if (!dot.waypoints || dot.waypoints.length === 0) return;

    const destCoord = dot.waypoints[dot.waypoints.length - 1];
    dot.pos = destCoord;

    if (dot.layers.dotOuter) dot.layers.dotOuter.setLatLng(destCoord);
    if (dot.layers.dotInner) dot.layers.dotInner.setLatLng(destCoord);
    if (dot.layers.dotEmoji) dot.layers.dotEmoji.setLatLng(destCoord);
    if (dot.layers.activePath) dot.layers.activePath.setLatLngs([]);

    dot.waypoints = [];
    dot.waterFlags = [];
    dot.segIdx = 0;
    dot.ferryTarget = null;
    dot.state = "Stop";
    dot.timeLeft = "--";
    dot.eta = "--";
  };

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      {/* Top-Left 4 Fat Bubbles Modal */}
      <div
        style={{
          position: "absolute",
          top: 15,
          left: 60,
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          fontFamily: "system-ui, -apple-system, sans-serif",
          pointerEvents: "auto",
        }}
      >
        {dotsUI.map((dot) => {
          const isSelected = selectedId === dot.id;

          return (
            <div
              key={dot.id}
              onClick={() => handleToggleSelect(dot.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "8px 16px",
                borderRadius: "32px",
                background: isSelected ? "#e8f5e9" : "rgba(255, 255, 255, 0.95)",
                border: isSelected ? "2.5px solid #2e7d32" : "1.5px solid #e0e0e0",
                boxShadow: isSelected
                  ? "0 4px 14px rgba(46, 125, 50, 0.35)"
                  : "0 2px 10px rgba(0, 0, 0, 0.15)",
                cursor: "pointer",
                transition: "all 0.2s ease-in-out",
                userSelect: "none",
              }}
            >
              {/* 1. Symbol */}
              <span style={{ fontSize: "22px", display: "flex", alignItems: "center" }}>
                {dot.symbol}
              </span>

              {/* 2. State Badge */}
              <span
                style={{
                  padding: "3px 9px",
                  borderRadius: "12px",
                  fontSize: "11px",
                  fontWeight: "bold",
                  color: "#fff",
                  minWidth: "48px",
                  textAlign: "center",
                  background:
                    dot.state === "Move"
                      ? "#2e7d32"
                      : dot.state === "Ferry"
                      ? "#0288d1"
                      : dot.state === "Redirecting"
                      ? "#ed6c02"
                      : "#757575",
                }}
              >
                {dot.state}
              </span>

              {/* 3. ETA */}
              <div style={{ fontSize: "12px", color: "#333", minWidth: "65px" }}>
                <span style={{ fontSize: "10px", color: "#888", display: "block" }}>ETA</span>
                <b>{dot.eta}</b>
              </div>

              {/* 4. Time Left */}
              <div style={{ fontSize: "12px", color: "#333", minWidth: "55px" }}>
                <span style={{ fontSize: "10px", color: "#888", display: "block" }}>Time Left</span>
                <b>{dot.timeLeft}</b>
              </div>

              {/* 5. +5ms^-1 Button */}
              <button
                onClick={(e) => handleAddSpeed(dot.id, e)}
                style={{
                  padding: "5px 10px",
                  background: "#0d6efd",
                  color: "#fff",
                  border: "none",
                  borderRadius: "16px",
                  fontSize: "11px",
                  fontWeight: "bold",
                  cursor: "pointer",
                }}
              >
                +5ms⁻¹
              </button>

              {/* 6. +10m Button */}
              <button
                onClick={(e) => handleAddRadius(dot.id, e)}
                style={{
                  padding: "5px 10px",
                  background: "#0dcaf0",
                  color: "#000",
                  border: "none",
                  borderRadius: "16px",
                  fontSize: "11px",
                  fontWeight: "bold",
                  cursor: "pointer",
                }}
              >
                +10m
              </button>

              {/* 7. TP Button */}
              <button
                onClick={(e) => handleTeleport(dot.id, e)}
                style={{
                  padding: "5px 10px",
                  background: "#6f42c1",
                  color: "#fff",
                  border: "none",
                  borderRadius: "16px",
                  fontSize: "11px",
                  fontWeight: "bold",
                  cursor: "pointer",
                }}
              >
                TP
              </button>
            </div>
          );
        })}
      </div>

      <div ref={mapContainerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}