// fetch.js
const workerBlob = new Blob([`
const SCALE = 10000000.0;
const K_LAT = 111132.95;
const K_LON = 111132.95 * Math.cos((22.35 * Math.PI) / 180);

function fastDist(lat1, lon1, lat2, lon2) {
  const dy = (lat2 - lat1) * K_LAT;
  const dx = (lon2 - lon1) * K_LON;
  return Math.sqrt(dx * dx + dy * dy);
}

function polylineLength(pts) {
  let d = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    d += fastDist(pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]);
  }
  return d;
}

class MinHeap {
  constructor() { this.heap = []; }
  push(item) { this.heap.push(item); this._bubbleUp(this.heap.length - 1); }
  pop() {
    const top = this.heap[0], bottom = this.heap.pop();
    if (this.heap.length > 0) { this.heap[0] = bottom; this._bubbleDown(0); }
    return top;
  }
  peek() { return this.heap[0]; }
  isEmpty() { return this.heap.length === 0; }
  _bubbleUp(idx) {
    while (idx > 0) {
      const p = (idx - 1) >> 1;
      if (this.heap[idx].priority < this.heap[p].priority) {
        [this.heap[idx], this.heap[p]] = [this.heap[p], this.heap[idx]];
        idx = p;
      } else break;
    }
  }
  _bubbleDown(idx) {
    const len = this.heap.length;
    while (true) {
      let left = (idx << 1) + 1, right = left + 1, smallest = idx;
      if (left < len && this.heap[left].priority < this.heap[smallest].priority) smallest = left;
      if (right < len && this.heap[right].priority < this.heap[smallest].priority) smallest = right;
      if (smallest !== idx) {
        [this.heap[idx], this.heap[smallest]] = [this.heap[smallest], this.heap[idx]];
        idx = smallest;
      } else break;
    }
  }
}

function hilbert(x, y) {
  let d = 0;
  for (let s = 1 << 15; s > 0; s >>= 1) {
    const rx = (x & s) > 0 ? 1 : 0, ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) { x = 65535 - x; y = 65535 - y; }
      const t = x; x = y; y = t;
    }
  }
  return d;
}

function boxDist(node, px, py) {
  const dx = px < node.minX ? node.minX - px : px > node.maxX ? px - node.maxX : 0;
  const dy = py < node.minY ? node.minY - py : py > node.maxY ? py - node.maxY : 0;
  return Math.sqrt(dx * dx * K_LON * K_LON + dy * dy * K_LAT * K_LAT);
}

function buildHilbertTree(start, end, boxes, macroIndices) {
  if (end - start === 1) {
    const idx = start;
    return {
      minX: boxes[idx * 4], minY: boxes[idx * 4 + 1],
      maxX: boxes[idx * 4 + 2], maxY: boxes[idx * 4 + 3],
      macroIdx: macroIndices[idx], left: null, right: null
    };
  }
  const mid = (start + end) >> 1;
  const left = buildHilbertTree(start, mid, boxes, macroIndices);
  const right = buildHilbertTree(mid, end, boxes, macroIndices);
  return {
    minX: Math.min(left.minX, right.minX), minY: Math.min(left.minY, right.minY),
    maxX: Math.max(left.maxX, right.maxX), maxY: Math.max(left.maxY, right.maxY),
    macroIdx: -1, left, right
  };
}

function rtreeFindNearest(root, qx, qy, evaluateMacroFn) {
  const pq = new MinHeap();
  pq.push({ node: root, priority: boxDist(root, qx, qy) });
  let bestDist = Infinity, bestResult = null;

  while (!pq.isEmpty()) {
    const { node, priority } = pq.pop();
    if (priority > bestDist) break;
    if (node.macroIdx !== -1) {
      const res = evaluateMacroFn(node.macroIdx, bestDist);
      if (res && res.dist < bestDist) {
        bestDist = res.dist;
        bestResult = res;
      }
    } else {
      if (node.left) {
        const dl = boxDist(node.left, qx, qy);
        if (dl <= bestDist) pq.push({ node: node.left, priority: dl });
      }
      if (node.right) {
        const dr = boxDist(node.right, qx, qy);
        if (dr <= bestDist) pq.push({ node: node.right, priority: dr });
      }
    }
  }
  return bestResult;
}

let G = null, rtreeRoot = null;
let gF, gB, parentF, parentB, parentEdgeF, parentEdgeB;
let visitedTokenF, visitedTokenB, closedTokenF, closedTokenB;
let queryToken = 0;

self.onmessage = function(e) {
  const { id, type, buffer, payload } = e.data;

  if (type === "INIT") {
    const view = new DataView(buffer);
    const numIntNodes = view.getUint32(8, true);
    const numDirEdges = view.getUint32(12, true);
    const numMacroEdges = view.getUint32(16, true);
    const totalShapePoints = view.getUint32(20, true);
    const minLat = view.getInt32(24, true), maxLat = view.getInt32(28, true);
    const minLon = view.getInt32(32, true), maxLon = view.getInt32(36, true);

    let offset = 64;
    const intCoords = new Int32Array(buffer, offset, numIntNodes * 2);
    offset += numIntNodes * 2 * 4;

    const nodeOffsets = new Uint32Array(buffer, offset, numIntNodes + 1);
    offset += (numIntNodes + 1) * 4;

    const dirTargetAndFlag = new Uint32Array(numDirEdges);
    const dirLength = new Float32Array(numDirEdges);
    const dirPolyAndDir = new Uint32Array(numDirEdges);

    for (let i = 0; i < numDirEdges; i++) {
      dirTargetAndFlag[i] = view.getUint32(offset, true);
      dirLength[i] = view.getFloat32(offset + 4, true);
      dirPolyAndDir[i] = view.getUint32(offset + 8, true);
      offset += 12;
    }

    const polylineOffsets = new Uint32Array(buffer, offset, numMacroEdges + 1);
    offset += (numMacroEdges + 1) * 4;
    const shapePool = new Int32Array(buffer, offset, totalShapePoints * 2);

    const macroEndpoints = new Int32Array(numMacroEdges * 2).fill(-1);
    const macroIsWater = new Uint8Array(numMacroEdges);

    for (let u = 0; u < numIntNodes; u++) {
      for (let edge = nodeOffsets[u]; edge < nodeOffsets[u + 1]; edge++) {
        const mIdx = dirPolyAndDir[edge] & 0x7fffffff;
        const v = dirTargetAndFlag[edge] & 0x7fffffff;
        macroIsWater[mIdx] = (dirTargetAndFlag[edge] >> 31) & 1;
        if (macroEndpoints[mIdx * 2] === -1) {
          macroEndpoints[mIdx * 2] = u;
          macroEndpoints[mIdx * 2 + 1] = v;
        }
      }
    }

    gF = new Float32Array(numIntNodes);
    gB = new Float32Array(numIntNodes);
    parentF = new Int32Array(numIntNodes);
    parentB = new Int32Array(numIntNodes);
    parentEdgeF = new Uint32Array(numIntNodes);
    parentEdgeB = new Uint32Array(numIntNodes);
    visitedTokenF = new Uint32Array(numIntNodes);
    visitedTokenB = new Uint32Array(numIntNodes);
    closedTokenF = new Uint32Array(numIntNodes);
    closedTokenB = new Uint32Array(numIntNodes);

    G = {
      numIntNodes, numDirEdges, numMacroEdges, minLat, maxLat, minLon, maxLon,
      intCoords, nodeOffsets, dirTargetAndFlag, dirLength, dirPolyAndDir,
      polylineOffsets, shapePool, macroEndpoints, macroIsWater
    };

    const landIndices = [];
    for (let i = 0; i < numMacroEdges; i++) if (macroIsWater[i] === 0) landIndices.push(i);

    const numLand = landIndices.length;
    const rawBoxes = new Float32Array(numLand * 4);
    const hilbertValues = new Uint32Array(numLand);
    const latSpan = (maxLat - minLat) / SCALE, lonSpan = (maxLon - minLon) / SCALE;

    for (let i = 0; i < numLand; i++) {
      const mIdx = landIndices[i];
      const u = macroEndpoints[mIdx * 2], v = macroEndpoints[mIdx * 2 + 1];

      let minX = Math.min(intCoords[u * 2 + 1], intCoords[v * 2 + 1]) / SCALE;
      let maxX = Math.max(intCoords[u * 2 + 1], intCoords[v * 2 + 1]) / SCALE;
      let minY = Math.min(intCoords[u * 2], intCoords[v * 2]) / SCALE;
      let maxY = Math.max(intCoords[u * 2], intCoords[v * 2]) / SCALE;

      const start = polylineOffsets[mIdx], end = polylineOffsets[mIdx + 1];
      for (let s = start; s < end; s++) {
        const py = shapePool[s * 2] / SCALE, px = shapePool[s * 2 + 1] / SCALE;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
      rawBoxes[i * 4] = minX; rawBoxes[i * 4 + 1] = minY;
      rawBoxes[i * 4 + 2] = maxX; rawBoxes[i * 4 + 3] = maxY;

      const cx = Math.floor(((minX + maxX) / 2 - minLon / SCALE) / lonSpan * 65535);
      const cy = Math.floor(((minY + maxY) / 2 - minLat / SCALE) / latSpan * 65535);
      hilbertValues[i] = hilbert(Math.max(0, Math.min(65535, cx)), Math.max(0, Math.min(65535, cy)));
    }

    const itemIndices = new Uint32Array(numLand);
    for (let i = 0; i < numLand; i++) itemIndices[i] = i;
    itemIndices.sort((a, b) => hilbertValues[a] - hilbertValues[b]);

    const sortedBoxes = new Float32Array(numLand * 4);
    const sortedMacroIndices = new Uint32Array(numLand);
    for (let i = 0; i < numLand; i++) {
      const orig = itemIndices[i];
      sortedMacroIndices[i] = landIndices[orig];
      sortedBoxes[i * 4] = rawBoxes[orig * 4];
      sortedBoxes[i * 4 + 1] = rawBoxes[orig * 4 + 1];
      sortedBoxes[i * 4 + 2] = rawBoxes[orig * 4 + 2];
      sortedBoxes[i * 4 + 3] = rawBoxes[orig * 4 + 3];
    }

    rtreeRoot = buildHilbertTree(0, numLand, sortedBoxes, sortedMacroIndices);
    self.postMessage({ id, bbox: [[minLat / SCALE, minLon / SCALE], [maxLat / SCALE, maxLon / SCALE]] });
  }

  if (type === "SNAP") {
    const snapPt = snapToNearest(payload.lat, payload.lon);
    self.postMessage({ id, result: snapPt });
  }

  if (type === "PATHFIND") {
    const { snapA, snapB } = payload;
    const A_prime = snapA.pt, B_prime = snapB.pt;
    const A1 = snapA.u, A2 = snapA.v;
    const B1 = snapB.u, B2 = snapB.v;

    const legA_A1 = slicePolylineToEndpoint(snapA, 'u');
    const legA_A2 = slicePolylineToEndpoint(snapA, 'v');
    const legB_B1 = slicePolylineToEndpoint(snapB, 'u');
    const legB_B2 = slicePolylineToEndpoint(snapB, 'v');

    let totalDist = Infinity;
    let fullRoutePts = [];
    let segmentWaterFlags = [];

    // Direct check if on same macro-edge
    if (snapA.macroIdx === snapB.macroIdx) {
      const sameEdgeLeg = sliceSameMacroEdge(snapA, snapB);
      totalDist = sameEdgeLeg.dist;
      fullRoutePts = sameEdgeLeg.pts;
      const isW = G.macroIsWater[snapA.macroIdx];
      segmentWaterFlags = new Array(Math.max(0, fullRoutePts.length - 1)).fill(isW);
    }

    const sources = [
      { node: A1, cost: legA_A1.dist, leg: legA_A1 },
      { node: A2, cost: legA_A2.dist, leg: legA_A2 }
    ];
    const targets = [
      { node: B1, cost: legB_B1.dist, leg: legB_B1 },
      { node: B2, cost: legB_B2.dist, leg: legB_B2 }
    ];

    const res = findUnifiedBidirectionalAStar(sources, targets, A_prime, B_prime);
    if (res && res.totalDist < totalDist) {
      totalDist = res.totalDist;

      // Extract mid-poly preserving every junction node and shape point
      const { full: midPoly, waterList: midWater } = buildFullPolylineWithFlags(res.edgeTrace);
      const legBPts = [...res.targetLeg.pts].reverse();

      // Avoid duplicating the meeting junction between source leg and mid polyline
      const startLegPts = res.sourceLeg.pts;
      const startFlags = new Array(Math.max(0, startLegPts.length - 1)).fill(0);
      const endFlags = new Array(Math.max(0, legBPts.length - 1)).fill(0);

      fullRoutePts = [...startLegPts, ...midPoly, ...legBPts.slice(1)];
      segmentWaterFlags = [...startFlags, ...midWater, ...endFlags];
    }

    const flatPolyline = new Float32Array(fullRoutePts.length * 2);
    for (let i = 0; i < fullRoutePts.length; i++) {
      flatPolyline[i * 2] = fullRoutePts[i][0];
      flatPolyline[i * 2 + 1] = fullRoutePts[i][1];
    }

    const waterFlags = new Uint8Array(segmentWaterFlags);

    self.postMessage(
      { id, totalDist, flatPolyline, waterFlags },
      [flatPolyline.buffer, waterFlags.buffer]
    );
  }
};

function findUnifiedBidirectionalAStar(sources, targets, A_prime, B_prime) {
  queryToken++;
  if (queryToken === 0xFFFFFFFF) {
    visitedTokenF.fill(0); visitedTokenB.fill(0);
    closedTokenF.fill(0); closedTokenB.fill(0);
    queryToken = 1;
  }
  const token = queryToken;
  const openF = new MinHeap(), openB = new MinHeap();

  const p = (u) => {
    const lat = G.intCoords[u * 2] / SCALE, lon = G.intCoords[u * 2 + 1] / SCALE;
    return (fastDist(lat, lon, B_prime[0], B_prime[1]) - fastDist(lat, lon, A_prime[0], A_prime[1])) * 0.5;
  };

  const sourceMap = new Map();
  for (let s of sources) {
    sourceMap.set(s.node, s.leg);
    gF[s.node] = s.cost;
    visitedTokenF[s.node] = token;
    parentF[s.node] = -1;
    openF.push({ node: s.node, priority: s.cost + p(s.node) });
  }

  const targetMap = new Map();
  for (let t of targets) {
    targetMap.set(t.node, t.leg);
    gB[t.node] = t.cost;
    visitedTokenB[t.node] = token;
    parentB[t.node] = -1;
    openB.push({ node: t.node, priority: t.cost - p(t.node) });
  }

  let mu = Infinity, meetingNode = -1;

  while (!openF.isEmpty() && !openB.isEmpty()) {
    const topF = openF.peek(), topB = openB.peek();
    if (topF.priority + topB.priority >= mu) break;

    if (topF.priority <= topB.priority) {
      const { node: curr } = openF.pop();
      if (closedTokenF[curr] === token) continue;
      closedTokenF[curr] = token;

      const currG = gF[curr];
      const startEdge = G.nodeOffsets[curr], endEdge = G.nodeOffsets[curr + 1];

      for (let e = startEdge; e < endEdge; e++) {
        const neighbor = G.dirTargetAndFlag[e] & 0x7fffffff;
        if (closedTokenF[neighbor] === token) continue;
        const tentativeG = currG + G.dirLength[e];

        if (visitedTokenF[neighbor] !== token || tentativeG < gF[neighbor]) {
          gF[neighbor] = tentativeG;
          visitedTokenF[neighbor] = token;
          parentF[neighbor] = curr;
          parentEdgeF[neighbor] = G.dirPolyAndDir[e];
          openF.push({ node: neighbor, priority: tentativeG + p(neighbor) });

          if (visitedTokenB[neighbor] === token) {
            const pathDist = tentativeG + gB[neighbor];
            if (pathDist < mu) { mu = pathDist; meetingNode = neighbor; }
          }
        }
      }
    } else {
      const { node: curr } = openB.pop();
      if (closedTokenB[curr] === token) continue;
      closedTokenB[curr] = token;

      const currG = gB[curr];
      const startEdge = G.nodeOffsets[curr], endEdge = G.nodeOffsets[curr + 1];

      for (let e = startEdge; e < endEdge; e++) {
        const neighbor = G.dirTargetAndFlag[e] & 0x7fffffff;
        if (closedTokenB[neighbor] === token) continue;
        const tentativeG = currG + G.dirLength[e];

        if (visitedTokenB[neighbor] !== token || tentativeG < gB[neighbor]) {
          gB[neighbor] = tentativeG;
          visitedTokenB[neighbor] = token;
          parentB[neighbor] = curr;
          parentEdgeB[neighbor] = G.dirPolyAndDir[e];
          openB.push({ node: neighbor, priority: tentativeG - p(neighbor) });

          if (visitedTokenF[neighbor] === token) {
            const pathDist = gF[neighbor] + tentativeG;
            if (pathDist < mu) { mu = pathDist; meetingNode = neighbor; }
          }
        }
      }
    }
  }

  if (meetingNode === -1) return null;

  const forwardEdges = [];
  let walkF = meetingNode;
  while (parentF[walkF] !== -1) {
    forwardEdges.unshift(parentEdgeF[walkF]);
    walkF = parentF[walkF];
  }

  const backwardEdges = [];
  let walkB = meetingNode;
  while (parentB[walkB] !== -1) {
    const nxt = parentB[walkB], edge = parentEdgeB[walkB];
    const isRev = (edge >> 31) & 1;
    backwardEdges.push((edge & 0x7fffffff) | (((isRev ^ 1) & 1) << 31));
    walkB = nxt;
  }

  return {
    totalDist: mu,
    edgeTrace: [...forwardEdges, ...backwardEdges],
    sourceLeg: sourceMap.get(walkF),
    targetLeg: targetMap.get(walkB)
  };
}

function snapToNearest(lat, lon) {
  return rtreeFindNearest(rtreeRoot, lon, lat, (macroIdx, currentBestDist) => {
    const u = G.macroEndpoints[macroIdx * 2], v = G.macroEndpoints[macroIdx * 2 + 1];
    const uCoord = [G.intCoords[u * 2] / SCALE, G.intCoords[u * 2 + 1] / SCALE];
    const vCoord = [G.intCoords[v * 2] / SCALE, G.intCoords[v * 2 + 1] / SCALE];

    const shapes = [];
    const start = G.polylineOffsets[macroIdx], end = G.polylineOffsets[macroIdx + 1];
    for (let s = start; s < end; s++) {
      shapes.push([G.shapePool[s * 2] / SCALE, G.shapePool[s * 2 + 1] / SCALE]);
    }
    const fullPolyline = [uCoord, ...shapes, vCoord];
    let localBest = null;

    for (let seg = 0; seg < fullPolyline.length - 1; seg++) {
      const proj = projectPointToSegment([lat, lon], fullPolyline[seg], fullPolyline[seg + 1]);
      if (proj.dist < currentBestDist) {
        currentBestDist = proj.dist;
        localBest = {
          dist: proj.dist, pt: proj.pt, macroIdx, segIdx: seg,
          u, v, uCoord, vCoord, fullPolyline
        };
      }
    }
    return localBest;
  });
}

function slicePolylineToEndpoint(snap, toEndpoint) {
  const { pt, segIdx, fullPolyline } = snap;
  const pts = [pt], intermediates = [];
  if (toEndpoint === 'u') {
    for (let i = segIdx; i >= 0; i--) {
      pts.push(fullPolyline[i]);
      if (i > 0) intermediates.push(fullPolyline[i]);
    }
  } else {
    for (let i = segIdx + 1; i < fullPolyline.length; i++) {
      pts.push(fullPolyline[i]);
      if (i < fullPolyline.length - 1) intermediates.push(fullPolyline[i]);
    }
  }
  return { pts, intermediates, dist: polylineLength(pts) };
}

function sliceSameMacroEdge(snapA, snapB) {
  const { fullPolyline } = snapA;
  const pts = [snapA.pt], intermediates = [];
  if (snapA.segIdx === snapB.segIdx) {
    pts.push(snapB.pt);
  } else if (snapA.segIdx < snapB.segIdx) {
    for (let i = snapA.segIdx + 1; i <= snapB.segIdx; i++) {
      pts.push(fullPolyline[i]);
      intermediates.push(fullPolyline[i]);
    }
    pts.push(snapB.pt);
  } else {
    for (let i = snapA.segIdx; i > snapB.segIdx; i--) {
      pts.push(fullPolyline[i]);
      intermediates.push(fullPolyline[i]);
    }
    pts.push(snapB.pt);
  }
  return { pts, intermediates, dist: polylineLength(pts) };
}

function projectPointToSegment(p, p1, p2) {
  const [lat, lon] = p, [lat1, lon1] = p1, [lat2, lon2] = p2;
  const dx = (lon2 - lon1) * K_LON, dy = (lat2 - lat1) * K_LAT;
  const dLenSq = dx * dx + dy * dy;
  if (dLenSq === 0) return { pt: [lat1, lon1], dist: fastDist(lat, lon, lat1, lon1) };

  const px = (lon - lon1) * K_LON, py = (lat - lat1) * K_LAT;
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / dLenSq));
  const projLat = lat1 + t * (lat2 - lat1);
  const projLon = lon1 + t * (lon2 - lon1);
  return { pt: [projLat, projLon], dist: fastDist(lat, lon, projLat, projLon) };
}

// FIX: Includes every intermediate degree-2 shape point AND every junction node
function buildFullPolylineWithFlags(edgeTrace) {
  const full = [], waterList = [];
  for (let pd of edgeTrace) {
    const macroIdx = pd & 0x7fffffff, isRev = (pd >> 31) & 1;
    const isW = G.macroIsWater[macroIdx];

    const u = G.macroEndpoints[macroIdx * 2];
    const v = G.macroEndpoints[macroIdx * 2 + 1];
    const targetJunction = (isRev === 0) ? v : u;
    const targetCoord = [
      G.intCoords[targetJunction * 2] / SCALE,
      G.intCoords[targetJunction * 2 + 1] / SCALE
    ];

    const shapes = [];
    const start = G.polylineOffsets[macroIdx], end = G.polylineOffsets[macroIdx + 1];
    for (let s = start; s < end; s++) {
      shapes.push([G.shapePool[s * 2] / SCALE, G.shapePool[s * 2 + 1] / SCALE]);
    }
    if (isRev === 1) shapes.reverse();

    for (let pt of shapes) {
      full.push(pt);
      waterList.push(isW);
    }
    // Append the destination junction node of this macro-edge
    full.push(targetCoord);
    waterList.push(isW);
  }
  return { full, waterList };
}
`], { type: "application/javascript" });

let worker = null;
let reqId = 0;
const pending = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(URL.createObjectURL(workerBlob));
    worker.onmessage = (e) => {
      const { id, ...data } = e.data;
      if (pending.has(id)) {
        const resolve = pending.get(id);
        pending.delete(id);
        resolve(data);
      }
    };
  }
  return worker;
}

function callWorker(type, payload = {}, transfers = []) {
  return new Promise((resolve) => {
    const id = ++reqId;
    pending.set(id, resolve);
    getWorker().postMessage({ id, type, payload }, transfers);
  });
}

let initPromise = null;

export function initGraph(url = "/graph.bin") {
  if (!initPromise) {
    initPromise = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to load ${url}: ${res.statusText}`);
      const buffer = await res.arrayBuffer();
      const w = getWorker();
      return new Promise((resolve) => {
        const id = ++reqId;
        pending.set(id, resolve);
        w.postMessage({ id, type: "INIT", buffer }, [buffer]);
      });
    })();
  }
  return initPromise;
}

export async function snap(lat, lon) {
  await initGraph();
  const res = await callWorker("SNAP", { lat, lon });
  return res.result;
}

export async function pathfind(snapA, snapB) {
  await initGraph();
  return await callWorker("PATHFIND", { snapA, snapB });
}