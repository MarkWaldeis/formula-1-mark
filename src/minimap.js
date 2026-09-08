export class F1Minimap {
  constructor(canvas, waypointsData, sim) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.waypoints = waypointsData.waypoints;
    this.sim = sim;
    
    // Calculate 2D bounding box
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (const wp of this.waypoints) {
      // wp.x is X, -wp.y is Z in Three.js
      const z = -wp.y;
      if (wp.x < minX) minX = wp.x;
      if (wp.x > maxX) maxX = wp.x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    this.bounds = { minX, maxX, minZ, maxZ };
    this.padding = 24;

    this.bgCanvas = null;
    this.initBackground();
  }

  worldToCanvas(x, z) {
    const w = this.canvas.width;
    const h = this.canvas.height;
    
    const rangeX = this.bounds.maxX - this.bounds.minX;
    const rangeZ = this.bounds.maxZ - this.bounds.minZ;

    const scale = Math.min((w - this.padding * 2) / rangeX, (h - this.padding * 2) / rangeZ);

    const cx = w / 2;
    const cy = h / 2;
    const midX = (this.bounds.minX + this.bounds.maxX) / 2;
    const midZ = (this.bounds.minZ + this.bounds.maxZ) / 2;

    const px = cx + (x - midX) * scale;
    const py = cy + (z - midZ) * scale;
    return { x: px, y: py };
  }

  initBackground() {
    this.bgCanvas = document.createElement('canvas');
    this.bgCanvas.width = this.canvas.width;
    this.bgCanvas.height = this.canvas.height;
    const bgCtx = this.bgCanvas.getContext('2d');
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Subtle background grid & glass glow
    bgCtx.fillStyle = "rgba(10, 15, 25, 0.75)";
    bgCtx.beginPath();
    bgCtx.roundRect(0, 0, w, h, 16);
    bgCtx.fill();
    bgCtx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    bgCtx.lineWidth = 1.5;
    bgCtx.stroke();

    // Draw Track Outline
    bgCtx.beginPath();
    for (let i = 0; i < this.waypoints.length; i++) {
      const wp = this.waypoints[i];
      const pt = this.worldToCanvas(wp.x, -wp.y);
      if (i === 0) bgCtx.moveTo(pt.x, pt.y);
      else bgCtx.lineTo(pt.x, pt.y);
    }
    bgCtx.closePath();

    // Track outer glow
    bgCtx.shadowColor = "rgba(0, 180, 255, 0.6)";
    bgCtx.shadowBlur = 8;
    bgCtx.strokeStyle = "rgba(200, 225, 255, 0.85)";
    bgCtx.lineWidth = 4.5;
    bgCtx.lineCap = "round";
    bgCtx.lineJoin = "round";
    bgCtx.stroke();
    bgCtx.shadowBlur = 0;

    // Start/Finish Line Indicator
    const sfPt = this.worldToCanvas(0, 40);
    bgCtx.fillStyle = "#ffffff";
    bgCtx.beginPath();
    bgCtx.arc(sfPt.x, sfPt.y, 4, 0, Math.PI * 2);
    bgCtx.fill();
  }

  draw() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Blit pre-rendered background instantly
    if (this.bgCanvas) {
      ctx.drawImage(this.bgCanvas, 0, 0);
    }

    // Draw Live Cars
    for (const car of this.sim.cars) {
      if (!car.modelGroup) continue;
      const pos = car.modelGroup.position;
      const pt = this.worldToCanvas(pos.x, pos.z);

      // Car halo ring
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = car.color || "#ff3333";
      ctx.stroke();

      // Inner car dot
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = car.color || "#ff3333";
      ctx.fill();

      // Driver tag
      ctx.font = "bold 9px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(`P${car.position}`, pt.x + 10, pt.y + 3);
    }
  }
}
