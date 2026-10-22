// minheap.js
export class MinHeap {
  constructor() {
    this.heap = [];
  }
  push(node, cost) {
    this.heap.push({ node, cost });
    this._bubbleUp(this.heap.length - 1);
  }
  pop() {
    if (this.heap.length === 0) return null;
    const top = this.heap[0];
    const bottom = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = bottom;
      this._sinkDown(0);
    }
    return top;
  }
  isEmpty() {
    return this.heap.length === 0;
  }
  _bubbleUp(n) {
    const el = this.heap[n];
    while (n > 0) {
      const pIdx = (n - 1) >> 1;
      const parent = this.heap[pIdx];
      if (el.cost >= parent.cost) break;
      this.heap[n] = parent;
      n = pIdx;
    }
    this.heap[n] = el;
  }
  _sinkDown(n) {
    const len = this.heap.length;
    const el = this.heap[n];
    while (true) {
      let swap = null;
      const r = (n + 1) << 1;
      const l = r - 1;
      if (l < len && this.heap[l].cost < el.cost) swap = l;
      if (r < len && this.heap[r].cost < (swap === null ? el.cost : this.heap[l].cost)) swap = r;
      if (swap === null) break;
      this.heap[n] = this.heap[swap];
      n = swap;
    }
    this.heap[n] = el;
  }
}