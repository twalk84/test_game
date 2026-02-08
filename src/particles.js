import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";

const MAX_PARTICLES = 2000;
const DEAD_Y = -9999;

export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.count = MAX_PARTICLES;

    // Pre-allocate buffers
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.colors = new Float32Array(MAX_PARTICLES * 3);
    this.sizes = new Float32Array(MAX_PARTICLES);
    this.velocities = new Float32Array(MAX_PARTICLES * 3);
    this.lives = new Float32Array(MAX_PARTICLES);     // current life remaining
    this.maxLives = new Float32Array(MAX_PARTICLES);   // total lifetime
    this.gravities = new Float32Array(MAX_PARTICLES);  // per-particle gravity

    // All particles start dead — position off-screen
    this.lives.fill(0);
    this.sizes.fill(0);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.positions[i * 3 + 1] = DEAD_Y;
    }
    this.nextFree = 0;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    geometry.setAttribute("size", new THREE.BufferAttribute(this.sizes, 1));

    const material = new THREE.PointsMaterial({
      vertexColors: true,
      size: 0.15,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.mesh = new THREE.Points(geometry, material);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  _allocate() {
    // Find next dead particle starting from nextFree
    for (let attempts = 0; attempts < MAX_PARTICLES; attempts++) {
      const i = this.nextFree;
      this.nextFree = (this.nextFree + 1) % MAX_PARTICLES;
      if (this.lives[i] <= 0) return i;
    }
    // All full — overwrite oldest (nextFree)
    return this.nextFree;
  }

  emit(x, y, z, vx, vy, vz, r, g, b, life, size, gravity) {
    const i = this._allocate();
    const i3 = i * 3;
    this.positions[i3] = x;
    this.positions[i3 + 1] = y;
    this.positions[i3 + 2] = z;
    this.velocities[i3] = vx;
    this.velocities[i3 + 1] = vy;
    this.velocities[i3 + 2] = vz;
    this.colors[i3] = r;
    this.colors[i3 + 1] = g;
    this.colors[i3 + 2] = b;
    this.lives[i] = life;
    this.maxLives[i] = life;
    this.sizes[i] = size;
    this.gravities[i] = gravity || 0;
  }

  // --- Preset emitters ---

  muzzleFlash(pos, direction) {
    for (let j = 0; j < 10; j++) {
      const spread = 0.4;
      const speed = 8 + Math.random() * 12;
      const vx = direction.x * speed + (Math.random() - 0.5) * spread * speed;
      const vy = direction.y * speed + (Math.random() - 0.5) * spread * speed + Math.random() * 2;
      const vz = direction.z * speed + (Math.random() - 0.5) * spread * speed;
      this.emit(pos.x, pos.y, pos.z, vx, vy, vz, 1.0, 0.9, 0.4, 0.04 + Math.random() * 0.04, 0.12 + Math.random() * 0.08, 0);
    }
  }

  bulletImpact(pos, color) {
    const r = ((color >> 16) & 0xff) / 255;
    const g = ((color >> 8) & 0xff) / 255;
    const b = (color & 0xff) / 255;
    for (let j = 0; j < 16; j++) {
      const speed = 3 + Math.random() * 5;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.5;
      const vx = Math.cos(theta) * Math.sin(phi) * speed;
      const vy = Math.cos(phi) * speed * 0.8 + Math.random() * 2;
      const vz = Math.sin(theta) * Math.sin(phi) * speed;
      this.emit(pos.x, pos.y, pos.z, vx, vy, vz, r * 0.8 + 0.2, g * 0.8 + 0.2, b * 0.8 + 0.2, 0.15 + Math.random() * 0.1, 0.08 + Math.random() * 0.06, 6);
    }
  }

  enemyDeath(pos, color) {
    const r = ((color >> 16) & 0xff) / 255;
    const g = ((color >> 8) & 0xff) / 255;
    const b = (color & 0xff) / 255;
    for (let j = 0; j < 35; j++) {
      const speed = 2 + Math.random() * 6;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const vx = Math.cos(theta) * Math.sin(phi) * speed;
      const vy = Math.abs(Math.cos(phi)) * speed + Math.random() * 3;
      const vz = Math.sin(theta) * Math.sin(phi) * speed;
      const shade = 0.6 + Math.random() * 0.4;
      this.emit(pos.x, pos.y + 0.5, pos.z, vx, vy, vz, r * shade, g * shade, b * shade, 0.4 + Math.random() * 0.3, 0.1 + Math.random() * 0.1, 8);
    }
  }

  collectPickup(pos, color) {
    const r = ((color >> 16) & 0xff) / 255;
    const g = ((color >> 8) & 0xff) / 255;
    const b = (color & 0xff) / 255;
    for (let j = 0; j < 18; j++) {
      const angle = (j / 18) * Math.PI * 2;
      const speed = 1.5 + Math.random() * 2;
      const vx = Math.cos(angle) * speed * 0.5;
      const vy = 3 + Math.random() * 4;
      const vz = Math.sin(angle) * speed * 0.5;
      this.emit(pos.x, pos.y, pos.z, vx, vy, vz, r, g, b, 0.3 + Math.random() * 0.2, 0.1 + Math.random() * 0.06, 1);
    }
  }

  levelUp(pos) {
    for (let j = 0; j < 40; j++) {
      const angle = (j / 40) * Math.PI * 2;
      const speed = 5 + Math.random() * 3;
      const vx = Math.cos(angle) * speed;
      const vy = 1 + Math.random() * 2;
      const vz = Math.sin(angle) * speed;
      this.emit(pos.x, pos.y + 1, pos.z, vx, vy, vz, 1.0, 0.85, 0.3, 0.4 + Math.random() * 0.2, 0.12 + Math.random() * 0.06, 2);
    }
  }

  trail(pos, color) {
    const r = ((color >> 16) & 0xff) / 255;
    const g = ((color >> 8) & 0xff) / 255;
    const b = (color & 0xff) / 255;
    this.emit(
      pos.x + (Math.random() - 0.5) * 0.05,
      pos.y + (Math.random() - 0.5) * 0.05,
      pos.z + (Math.random() - 0.5) * 0.05,
      (Math.random() - 0.5) * 0.3,
      (Math.random() - 0.5) * 0.3,
      (Math.random() - 0.5) * 0.3,
      r, g, b,
      0.08 + Math.random() * 0.06,
      0.06 + Math.random() * 0.04,
      0
    );
  }

  update(dt) {
    const posAttr = this.mesh.geometry.attributes.position;
    const colAttr = this.mesh.geometry.attributes.color;
    const sizeAttr = this.mesh.geometry.attributes.size;

    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.lives[i] <= 0) {
        // Move dead particles off-screen (PointsMaterial ignores per-vertex size)
        const i3 = i * 3;
        posAttr.array[i3 + 1] = DEAD_Y;
        colAttr.array[i3] = 0;
        colAttr.array[i3 + 1] = 0;
        colAttr.array[i3 + 2] = 0;
        continue;
      }

      this.lives[i] -= dt;
      const i3 = i * 3;

      if (this.lives[i] <= 0) {
        // Just died this frame — move off-screen immediately
        posAttr.array[i3 + 1] = DEAD_Y;
        colAttr.array[i3] = 0;
        colAttr.array[i3 + 1] = 0;
        colAttr.array[i3 + 2] = 0;
        continue;
      }

      // Apply gravity
      this.velocities[i3 + 1] -= this.gravities[i] * dt;

      // Move
      this.positions[i3] += this.velocities[i3] * dt;
      this.positions[i3 + 1] += this.velocities[i3 + 1] * dt;
      this.positions[i3 + 2] += this.velocities[i3 + 2] * dt;

      // Fade color toward darker as life runs out
      const lifeRatio = Math.max(0, this.lives[i] / this.maxLives[i]);
      colAttr.array[i3] = this.colors[i3] * lifeRatio;
      colAttr.array[i3 + 1] = this.colors[i3 + 1] * lifeRatio;
      colAttr.array[i3 + 2] = this.colors[i3 + 2] * lifeRatio;
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
  }
}
