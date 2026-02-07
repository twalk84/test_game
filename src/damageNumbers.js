import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";

const MAX_NUMBERS = 30;

export class DamageNumberSystem {
  constructor(camera) {
    this.camera = camera;
    this.numbers = [];
    this.container = document.createElement("div");
    this.container.id = "damage-numbers";
    Object.assign(this.container.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: "13",
      overflow: "hidden",
    });
    document.body.appendChild(this.container);
  }

  spawn(worldPos, amount, color = "#ffffff", large = false) {
    // Recycle oldest if at max
    if (this.numbers.length >= MAX_NUMBERS) {
      const old = this.numbers.shift();
      if (old.el.parentNode) old.el.parentNode.removeChild(old.el);
    }

    const el = document.createElement("div");
    el.textContent = Math.round(amount);
    Object.assign(el.style, {
      position: "absolute",
      color,
      fontWeight: "bold",
      fontSize: large ? "22px" : "16px",
      textShadow: "0 0 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.5)",
      fontFamily: "Arial, sans-serif",
      whiteSpace: "nowrap",
      transition: "none",
      pointerEvents: "none",
    });
    this.container.appendChild(el);

    this.numbers.push({
      el,
      worldPos: worldPos.clone(),
      life: 1.0,
      vy: 1.5 + Math.random() * 0.5,
      vx: (Math.random() - 0.5) * 0.5,
    });
  }

  update(dt) {
    const screenVec = new THREE.Vector3();

    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.life -= dt;
      n.worldPos.y += n.vy * dt;
      n.worldPos.x += n.vx * dt;

      if (n.life <= 0) {
        if (n.el.parentNode) n.el.parentNode.removeChild(n.el);
        this.numbers.splice(i, 1);
        continue;
      }

      // Project 3D to screen
      screenVec.copy(n.worldPos);
      screenVec.project(this.camera);

      // Behind camera check
      if (screenVec.z > 1) {
        n.el.style.display = "none";
        continue;
      }

      const x = (screenVec.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-screenVec.y * 0.5 + 0.5) * window.innerHeight;

      n.el.style.display = "block";
      n.el.style.left = x + "px";
      n.el.style.top = y + "px";
      n.el.style.opacity = String(Math.min(1, n.life * 2));
      n.el.style.transform = `translate(-50%, -50%) scale(${0.8 + n.life * 0.4})`;
    }
  }

  cleanup() {
    for (const n of this.numbers) {
      if (n.el.parentNode) n.el.parentNode.removeChild(n.el);
    }
    this.numbers = [];
  }
}
