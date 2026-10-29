// --- GLOWING CIRCLE & DYNAMIC BOUNDARY CONFIG ---
export const INITIAL_CIRCLE_CENTER_LAT = 22.3749714;
export const INITIAL_CIRCLE_CENTER_LON = 114.1391081;
export const INITIAL_CIRCLE_RADIUS_METERS = 37211.51;
export const BOUNDARY_MARGIN_METERS = 2000.0;
export const BASE_SPAN_METERS = INITIAL_CIRCLE_RADIUS_METERS + BOUNDARY_MARGIN_METERS;

// Game Time Constants: 06:00:00 to 18:00:00 (12 hours = 43,200 seconds)
export const START_GAME_SECONDS = 6 * 3600;
export const END_GAME_SECONDS = 18 * 3600;
export const TIME_SCALE = 20; // 1s irl = 20s in-game

export const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

export const SATELLITE_STYLE = {
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
      maxzoom: 19,
    },
  ],
};

export const TEAM_COLORS = [
  "#D50000", "#FF5500", "#C87800", "#008828",
  "#5EA800", "#0088D6", "#002BFF", "#5500FF",
  "#FF1464", "#7B3800", "#66002A", "#003866",
];

export const DOT_CONFIGS = [
  { id: 0, symbol: "👮", name: "Officer" },
  { id: 1, symbol: "🚔", name: "Cruiser" },
  { id: 2, symbol: "🚁", name: "Chopper" },
  { id: 3, symbol: "🏃", name: "Runner" },
];

export const STATE_COLORS = {
  Move: "#2e7d32",
  Ferry: "#0288d1",
  Redirecting: "#ed6c02",
  Stop: "#757575",
};

export function offsetLatLon(lat, lon, northMeters, eastMeters) {
  const dLat = (northMeters / 6371000.0) * (180 / Math.PI);
  const dLon =
    (eastMeters / (6371000.0 * Math.cos((lat * Math.PI) / 180))) *
    (180 / Math.PI);
  return [lat + dLat, lon + dLon];
}

function getZoneCenter(currentLat, currentLon) {
  return offsetLatLon(currentLat, currentLon, 100, 100);
}

const ZONE_CENTERS = (() => {
  const centers = [[INITIAL_CIRCLE_CENTER_LAT, INITIAL_CIRCLE_CENTER_LON]];
  for (let i = 1; i <= 9; i++) {
    const prev = centers[i - 1];
    centers.push(getZoneCenter(prev[0], prev[1]));
  }
  return centers;
})();

const toSec = (h, m) => h * 3600 + m * 60;

export const TIMELINE = [
  { phase: 1, type: "pause",  startSec: toSec(6, 0),   endSec: toSec(7, 54),  startR: 37211.51, endR: 37211.51, startCenter: ZONE_CENTERS[0], endCenter: ZONE_CENTERS[0], nextTargetR: 24050.0, nextTargetCenter: ZONE_CENTERS[1] },
  { phase: 1, type: "shrink", startSec: toSec(7, 54),  endSec: toSec(9, 49),  startR: 37211.51, endR: 24050.0,  startCenter: ZONE_CENTERS[0], endCenter: ZONE_CENTERS[1], nextTargetR: 24050.0, nextTargetCenter: ZONE_CENTERS[1] },
  { phase: 2, type: "pause",  startSec: toSec(9, 49),  endSec: toSec(11, 5),  startR: 24050.0,  endR: 24050.0,  startCenter: ZONE_CENTERS[1], endCenter: ZONE_CENTERS[1], nextTargetR: 13880.0, nextTargetCenter: ZONE_CENTERS[2] },
  { phase: 2, type: "shrink", startSec: toSec(11, 5),  endSec: toSec(11, 55), startR: 24050.0,  endR: 13880.0,  startCenter: ZONE_CENTERS[1], endCenter: ZONE_CENTERS[2], nextTargetR: 13880.0, nextTargetCenter: ZONE_CENTERS[2] },
  { phase: 3, type: "pause",  startSec: toSec(11, 55), endSec: toSec(12, 52), startR: 13880.0,  endR: 13880.0,  startCenter: ZONE_CENTERS[2], endCenter: ZONE_CENTERS[2], nextTargetR: 7400.0, nextTargetCenter: ZONE_CENTERS[3] },
  { phase: 3, type: "shrink", startSec: toSec(12, 52), endSec: toSec(13, 26), startR: 13880.0,  endR: 7400.0,   startCenter: ZONE_CENTERS[2], endCenter: ZONE_CENTERS[3], nextTargetR: 7400.0, nextTargetCenter: ZONE_CENTERS[3] },
  { phase: 4, type: "pause",  startSec: toSec(13, 26), endSec: toSec(14, 12), startR: 7400.0,   endR: 7400.0,   startCenter: ZONE_CENTERS[3], endCenter: ZONE_CENTERS[3], nextTargetR: 3700.0, nextTargetCenter: ZONE_CENTERS[4] },
  { phase: 4, type: "shrink", startSec: toSec(14, 12), endSec: toSec(14, 35), startR: 7400.0,   endR: 3700.0,   startCenter: ZONE_CENTERS[3], endCenter: ZONE_CENTERS[4], nextTargetR: 3700.0, nextTargetCenter: ZONE_CENTERS[4] },
  { phase: 5, type: "pause",  startSec: toSec(14, 35), endSec: toSec(15, 21), startR: 3700.0,   endR: 3700.0,   startCenter: ZONE_CENTERS[4], endCenter: ZONE_CENTERS[4], nextTargetR: 1850.0, nextTargetCenter: ZONE_CENTERS[5] },
  { phase: 5, type: "shrink", startSec: toSec(15, 21), endSec: toSec(15, 36), startR: 3700.0,   endR: 1850.0,   startCenter: ZONE_CENTERS[4], endCenter: ZONE_CENTERS[5], nextTargetR: 1850.0, nextTargetCenter: ZONE_CENTERS[5] },
  { phase: 6, type: "pause",  startSec: toSec(15, 36), endSec: toSec(16, 10), startR: 1850.0,   endR: 1850.0,   startCenter: ZONE_CENTERS[5], endCenter: ZONE_CENTERS[5], nextTargetR: 925.0, nextTargetCenter: ZONE_CENTERS[6] },
  { phase: 6, type: "shrink", startSec: toSec(16, 10), endSec: toSec(16, 22), startR: 1850.0,   endR: 925.0,    startCenter: ZONE_CENTERS[5], endCenter: ZONE_CENTERS[6], nextTargetR: 925.0, nextTargetCenter: ZONE_CENTERS[6] },
  { phase: 7, type: "pause",  startSec: toSec(16, 22), endSec: toSec(16, 56), startR: 925.0,    endR: 925.0,    startCenter: ZONE_CENTERS[6], endCenter: ZONE_CENTERS[6], nextTargetR: 463.0, nextTargetCenter: ZONE_CENTERS[7] },
  { phase: 7, type: "shrink", startSec: toSec(16, 56), endSec: toSec(17, 7),  startR: 925.0,    endR: 463.0,    startCenter: ZONE_CENTERS[6], endCenter: ZONE_CENTERS[7], nextTargetR: 463.0, nextTargetCenter: ZONE_CENTERS[7] },
  { phase: 8, type: "pause",  startSec: toSec(17, 7),  endSec: toSec(17, 30), startR: 463.0,    endR: 463.0,    startCenter: ZONE_CENTERS[7], endCenter: ZONE_CENTERS[7], nextTargetR: 185.0, nextTargetCenter: ZONE_CENTERS[8] },
  { phase: 8, type: "shrink", startSec: toSec(17, 30), endSec: toSec(17, 42), startR: 463.0,    endR: 185.0,    startCenter: ZONE_CENTERS[7], endCenter: ZONE_CENTERS[8], nextTargetR: 185.0, nextTargetCenter: ZONE_CENTERS[8] },
  { phase: 9, type: "pause",  startSec: toSec(17, 42), endSec: toSec(17, 47), startR: 185.0,    endR: 185.0,    startCenter: ZONE_CENTERS[8], endCenter: ZONE_CENTERS[8], nextTargetR: 0.0, nextTargetCenter: ZONE_CENTERS[9] },
  { phase: 9, type: "shrink", startSec: toSec(17, 47), endSec: toSec(18, 0),  startR: 185.0,    endR: 0.0,      startCenter: ZONE_CENTERS[8], endCenter: ZONE_CENTERS[9], nextTargetR: 0.0, nextTargetCenter: ZONE_CENTERS[9] },
];

export function getZoneState(gameSec) {
  const s = Math.min(Math.max(gameSec, START_GAME_SECONDS), END_GAME_SECONDS);
  let stage = TIMELINE.find((st) => s >= st.startSec && s < st.endSec);
  if (!stage) stage = TIMELINE[TIMELINE.length - 1];

  const duration = stage.endSec - stage.startSec;
  const progress = duration > 0 ? (s - stage.startSec) / duration : 1.0;

  const currentRadius = stage.startR + (stage.endR - stage.startR) * progress;
  const currentCenterLat =
    stage.startCenter[0] + (stage.endCenter[0] - stage.startCenter[0]) * progress;
  const currentCenterLon =
    stage.startCenter[1] + (stage.endCenter[1] - stage.startCenter[1]) * progress;

  const remainingSec = Math.max(0, stage.endSec - s);

  return {
    phase: stage.phase,
    isShrinking: stage.type === "shrink",
    radius: Math.max(0, currentRadius),
    center: [currentCenterLat, currentCenterLon],
    remainingSec,
    targetEndSec: stage.endSec,
    nextTargetR: stage.nextTargetR,
    nextTargetCenter: stage.nextTargetCenter,
    originRadius: stage.startR,
    originCenter: stage.startCenter,
  };
}

export function calculateDynamicBounds(width, height) {
  const w = width || window.innerWidth || 1;
  const h = height || window.innerHeight || 1;

  let spanNorthSouthMeters;
  let spanEastWestMeters;

  if (w > h) {
    spanNorthSouthMeters = BASE_SPAN_METERS;
    spanEastWestMeters = BASE_SPAN_METERS * (w / h);
  } else {
    spanEastWestMeters = BASE_SPAN_METERS;
    spanNorthSouthMeters = BASE_SPAN_METERS * (h / w);
  }

  const dLat = (spanNorthSouthMeters / 6371000.0) * (180 / Math.PI);
  const dLon =
    (spanEastWestMeters /
      (6371000.0 * Math.cos((INITIAL_CIRCLE_CENTER_LAT * Math.PI) / 180))) *
    (180 / Math.PI);

  return [
    [INITIAL_CIRCLE_CENTER_LON - dLon, INITIAL_CIRCLE_CENTER_LAT - dLat],
    [INITIAL_CIRCLE_CENTER_LON + dLon, INITIAL_CIRCLE_CENTER_LAT + dLat],
  ];
}

export function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [
        parseInt(result[1], 16) / 255,
        parseInt(result[2], 16) / 255,
        parseInt(result[3], 16) / 255,
      ]
    : [1, 0, 0];
}

export function formatGameClock(totalSeconds) {
  const s = Math.min(Math.max(totalSeconds, START_GAME_SECONDS), END_GAME_SECONDS);
  const hours = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = Math.floor(s % 60);
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function formatEtaRounded(totalSeconds) {
  const s = Math.min(Math.max(totalSeconds, START_GAME_SECONDS), END_GAME_SECONDS);
  const roundedSec = Math.ceil(s / 60) * 60;
  const hours = Math.floor(roundedSec / 3600) % 24;
  const mins = Math.floor((roundedSec % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function formatDurationRounded(sec) {
  const totalMins = Math.ceil(sec / 60);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return `${hours}h${mins}m`;
}

export function formatRadiusDisplay(r) {
  if (r >= 1000) {
    return `${(r / 1000).toFixed(1)}km`;
  }
  return `${Math.round(r)}m`;
}

export function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000.0;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function createCircleGeoJSON(centerLat, centerLon, radiusMeters, points = 128) {
  if (radiusMeters <= 0) return [];
  const coords = [];
  const dRad = radiusMeters / 6371000.0;
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

export function createBorderShrinkLayer(teamColorRef, zoneStateRef) {
  return {
    id: "border-shrink-layer",
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
        uniform vec2 u_circle_center;
        uniform float u_circle_radius_px;
        uniform float u_time;
        uniform vec3 u_color;
        uniform float u_is_shrinking;

        void main() {
          vec2 fragCoord = gl_FragCoord.xy;
          fragCoord.y = u_resolution.y - fragCoord.y;

          float d = distance(fragCoord, u_circle_center);

          if (d <= u_circle_radius_px) {
            discard;
          }

          float stripeWidth = 40.0;
          float speed = 75.0;
          float movingX = fragCoord.x - (u_time * speed * u_is_shrinking);

          float pattern = sin((movingX + fragCoord.y * 0.35) * (3.14159265 / stripeWidth));
          float stripeAlpha = smoothstep(-0.2, 0.2, pattern);

          vec3 darkBase = vec3(0.04, 0.04, 0.06);
          vec3 finalColor = mix(darkBase, u_color, stripeAlpha * 0.65 + 0.15);
          float alpha = 0.50 + stripeAlpha * 0.28;

          gl_FragColor = vec4(finalColor, alpha);
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
      this.uCenter = gl.getUniformLocation(prog, "u_circle_center");
      this.uRadius = gl.getUniformLocation(prog, "u_circle_radius_px");
      this.uTime = gl.getUniformLocation(prog, "u_time");
      this.uColor = gl.getUniformLocation(prog, "u_color");
      this.uIsShrinking = gl.getUniformLocation(prog, "u_is_shrinking");

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
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.width;
      const height = canvas.height;

      gl.uniform2f(this.uRes, width, height);

      const zone = zoneStateRef.current;
      const center = zone ? zone.center : [INITIAL_CIRCLE_CENTER_LAT, INITIAL_CIRCLE_CENTER_LON];
      const radius = zone ? zone.radius : INITIAL_CIRCLE_RADIUS_METERS;
      const isShrinking = zone && zone.isShrinking ? 1.0 : 0.0;

      const pt = map.project([center[1], center[0]]);
      gl.uniform2f(this.uCenter, pt.x * dpr, pt.y * dpr);

      const edgeCoord = offsetLatLon(center[0], center[1], 0, radius);
      const ptEdge = map.project([edgeCoord[1], edgeCoord[0]]);
      const pxRadius = Math.hypot((ptEdge.x - pt.x) * dpr, (ptEdge.y - pt.y) * dpr);
      gl.uniform1f(this.uRadius, Math.max(0, pxRadius));

      gl.uniform1f(this.uTime, performance.now() / 1000.0);
      gl.uniform1f(this.uIsShrinking, isShrinking);

      const rgb = hexToRgb(teamColorRef.current);
      gl.uniform3f(this.uColor, rgb[0], rgb[1], rgb[2]);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.enableVertexAttribArray(this.aPos);
      gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
  };
}

// Custom WebGL Fog-of-War Layer with dynamic opacity support
export function createFogLayer(dotsRef, unitsPlacedRef, fogOpacityRef) {
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
        uniform float u_fog_opacity;

        void main() {
          if (u_fog_opacity <= 0.001) {
            discard;
          }

          vec2 fragCoord = gl_FragCoord.xy;
          fragCoord.y = u_resolution.y - fragCoord.y;

          float fogFactor = 1.0;

          for (int i = 0; i < 4; i++) {
            if (i >= u_unit_count) break;
            float d = distance(fragCoord, u_centers[i]);
            float rInner = u_radii[i] * (400.0 / 600.0);
            float rOuter = u_radii[i];

            if (d <= rInner) {
              discard;
            }
            if (d < rOuter) {
              float vis = 1.0 - smoothstep(rInner, rOuter, d);
              fogFactor *= (1.0 - vis);
            }
          }

          float fogOpacity = 0.72 * fogFactor * u_fog_opacity;
          if (fogOpacity <= 0.002) discard;
          gl_FragColor = vec4(0.027, 0.054, 0.090, fogOpacity);
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
      this.uFogOpacity = gl.getUniformLocation(prog, "u_fog_opacity");

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

      const currentFogMultiplier = fogOpacityRef ? fogOpacityRef.current : 1.0;
      gl.uniform1f(this.uFogOpacity, currentFogMultiplier);

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
          const sightMeters = dot.sight || 200.0;
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