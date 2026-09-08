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

  draw() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Subtle background grid & glass glow
    ctx.fillStyle = "rgba(10, 15, 25, 0.75)";
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 16);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Draw Track Outline
    ctx.beginPath();
    for (let i = 0; i < this.waypoints.length; i++) {
      const wp = this.waypoints[i];
      const pt = this.worldToCanvas(wp.x, -wp.y);
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.closePath();

    // Track outer glow
    ctx.shadowColor = "rgba(0, 180, 255, 0.6)";
    ctx.shadowBlur = 8;
    ctx.strokeStyle = "rgba(200, 225, 255, 0.85)";
    ctx.lineWidth = 4.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();

    // Reset shadow
    ctx.shadowBlur = 0;

    // Start/Finish Line Indicator
    const sfPt = this.worldToCanvas(0, 40);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(sfPt.x, sfPt.y, 4, 0, Math.PI * 2);
    ctx.fill();

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
