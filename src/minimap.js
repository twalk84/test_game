import { CONFIG } from "./config.js";

const MAP_SIZE = 160;
const HALF_MAP = MAP_SIZE / 2;
const WORLD_HALF = CONFIG.world.size / 2;

export class Minimap {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = MAP_SIZE;
    this.canvas.height = MAP_SIZE;
    this.canvas.id = "minimap";
    Object.assign(this.canvas.style, {
      position: "fixed",
      top: "12px",
      right: "12px",
      width: MAP_SIZE + "px",
      height: MAP_SIZE + "px",
      borderRadius: "50%",
      border: "2px solid rgba(255,255,255,0.3)",
      background: "rgba(0,0,0,0.45)",
      zIndex: "12",
      pointerEvents: "none",
    });
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this.zoom = 0.7; // world units per pixel
    this.zoomLevels = [0.5, 0.7, 1.2];
    this.zoomIndex = 1;
  }

  cycleZoom() {
    this.zoomIndex = (this.zoomIndex + 1) % this.zoomLevels.length;
    this.zoom = this.zoomLevels[this.zoomIndex];
  }

  _worldToMap(wx, wz, playerX, playerZ) {
    const dx = (wx - playerX) / this.zoom;
    const dz = (wz - playerZ) / this.zoom;
    return {
      x: HALF_MAP + dx,
      y: HALF_MAP - dz, // flip Z so north is up
    };
  }

  update(playerPos, playerYaw, enemies, collectibles, hazardZones) {
    const ctx = this.ctx;
    const px = playerPos.x;
    const pz = playerPos.z;

    // Clear with circle clip
    ctx.save();
    ctx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
    ctx.beginPath();
    ctx.arc(HALF_MAP, HALF_MAP, HALF_MAP, 0, Math.PI * 2);
    ctx.clip();

    // Background
    ctx.fillStyle = "rgba(20, 35, 20, 0.75)";
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

    // World boundary
    const bTL = this._worldToMap(-WORLD_HALF, -WORLD_HALF, px, pz);
    const bBR = this._worldToMap(WORLD_HALF, WORLD_HALF, px, pz);
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 1;
    ctx.strokeRect(bTL.x, bBR.y, bBR.x - bTL.x, bTL.y - bBR.y);

    // Hazard zones (red circles)
    for (const zone of hazardZones) {
      const hp = this._worldToMap(zone.x, zone.z, px, pz);
      const r = zone.radius / this.zoom;
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 60, 30, 0.25)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 60, 30, 0.5)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Collectibles (yellow dots)
    if (collectibles) {
      for (const c of collectibles) {
        if (!c.alive) continue;
        const cp = this._worldToMap(c.mesh.position.x, c.mesh.position.z, px, pz);
        if (cp.x < -5 || cp.x > MAP_SIZE + 5 || cp.y < -5 || cp.y > MAP_SIZE + 5) continue;
        ctx.beginPath();
        ctx.arc(cp.x, cp.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = "#ffcc44";
        ctx.fill();
      }
    }

    // Enemies (color-coded dots)
    const enemyColors = {
      bruiser: "#c45454",
      shooter: "#4f7acb",
      stalker: "#9b59b6",
      tank: "#e67e22",
    };
    for (const e of enemies) {
      if (!e.alive) continue;
      const ep = this._worldToMap(e.mesh.position.x, e.mesh.position.z, px, pz);
      if (ep.x < -5 || ep.x > MAP_SIZE + 5 || ep.y < -5 || ep.y > MAP_SIZE + 5) continue;
      const size = e.type === "tank" ? 4 : e.type === "stalker" ? 2.5 : 3;
      ctx.beginPath();
      ctx.arc(ep.x, ep.y, size, 0, Math.PI * 2);
      ctx.fillStyle = enemyColors[e.type] || "#ff4444";
      ctx.fill();
    }

    // Player arrow (center, rotated by yaw)
    ctx.save();
    ctx.translate(HALF_MAP, HALF_MAP);
    ctx.rotate(-playerYaw);
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(-4, 5);
    ctx.lineTo(0, 2);
    ctx.lineTo(4, 5);
    ctx.closePath();
    ctx.fillStyle = "#44ff88";
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  }
}
