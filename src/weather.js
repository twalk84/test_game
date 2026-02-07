import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";
import { CONFIG } from "./config.js";

const RAIN_COUNT = 2500;
const RAIN_AREA = 60; // area around player
const RAIN_HEIGHT = 30;

const STATES = ["clear", "cloudy", "rain", "storm"];

export class WeatherSystem {
  constructor(scene) {
    this.scene = scene;
    this.state = "clear";
    this.nextChangeAt = 60 + Math.random() * 60;
    this.transitionProgress = 1; // 1 = fully transitioned
    this.transitionDuration = 12;
    this.transitionTimer = 0;
    this.previousState = "clear";

    this.windStrength = 0;
    this.windDirection = new THREE.Vector3(1, 0, 0.3).normalize();

    // Lightning
    this.lightningTimer = 0;
    this.lightningFlash = 0;
    this.thunderQueue = [];

    // Rain particles
    const rainGeo = new THREE.BufferGeometry();
    this.rainPositions = new Float32Array(RAIN_COUNT * 3);
    this.rainVelocities = new Float32Array(RAIN_COUNT);

    for (let i = 0; i < RAIN_COUNT; i++) {
      this.rainPositions[i * 3] = (Math.random() - 0.5) * RAIN_AREA;
      this.rainPositions[i * 3 + 1] = Math.random() * RAIN_HEIGHT;
      this.rainPositions[i * 3 + 2] = (Math.random() - 0.5) * RAIN_AREA;
      this.rainVelocities[i] = 18 + Math.random() * 8;
    }

    rainGeo.setAttribute("position", new THREE.BufferAttribute(this.rainPositions, 3));

    this.rainMaterial = new THREE.PointsMaterial({
      color: 0xaaccee,
      size: 0.12,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.rainMesh = new THREE.Points(rainGeo, this.rainMaterial);
    this.rainMesh.frustumCulled = false;
    scene.add(this.rainMesh);

    // Lightning light
    this.lightningLight = new THREE.PointLight(0xccddff, 0, 200);
    this.lightningLight.position.set(0, 50, 0);
    scene.add(this.lightningLight);
  }

  _pickNextState() {
    const weights = {
      clear: { clear: 0.2, cloudy: 0.6, rain: 0.15, storm: 0.05 },
      cloudy: { clear: 0.3, cloudy: 0.2, rain: 0.4, storm: 0.1 },
      rain: { clear: 0.1, cloudy: 0.3, rain: 0.3, storm: 0.3 },
      storm: { clear: 0.05, cloudy: 0.35, rain: 0.45, storm: 0.15 },
    };
    const w = weights[this.state] || weights.clear;
    let r = Math.random();
    for (const s of STATES) {
      r -= w[s];
      if (r <= 0) return s;
    }
    return "clear";
  }

  _getRainIntensity() {
    const current = this.state === "rain" ? 0.7 : this.state === "storm" ? 1.0 : 0;
    const previous = this.previousState === "rain" ? 0.7 : this.previousState === "storm" ? 1.0 : 0;
    return previous + (current - previous) * this.transitionProgress;
  }

  _getFogDensity() {
    const fogMap = { clear: 0, cloudy: 0.15, rain: 0.4, storm: 0.6 };
    const current = fogMap[this.state] || 0;
    const previous = fogMap[this.previousState] || 0;
    return previous + (current - previous) * this.transitionProgress;
  }

  getWindForce() {
    if (this.state !== "storm" && this.previousState !== "storm") return null;
    const stormCurrent = this.state === "storm" ? 1 : 0;
    const stormPrev = this.previousState === "storm" ? 1 : 0;
    const intensity = stormPrev + (stormCurrent - stormPrev) * this.transitionProgress;
    if (intensity < 0.01) return null;
    return this.windDirection.clone().multiplyScalar(this.windStrength * intensity * 3);
  }

  getEnemyDetectionMultiplier() {
    const map = { clear: 1.0, cloudy: 1.0, rain: 0.8, storm: 0.6 };
    const current = map[this.state] || 1;
    const previous = map[this.previousState] || 1;
    return previous + (current - previous) * this.transitionProgress;
  }

  update(dt, gameTime, playerPos) {
    // State transitions
    this.nextChangeAt -= dt;
    if (this.nextChangeAt <= 0) {
      this.previousState = this.state;
      this.state = this._pickNextState();
      this.transitionProgress = 0;
      this.transitionTimer = 0;
      this.nextChangeAt = 60 + Math.random() * 60;

      // Randomize wind direction on change
      const angle = Math.random() * Math.PI * 2;
      this.windDirection.set(Math.cos(angle), 0, Math.sin(angle));
    }

    if (this.transitionProgress < 1) {
      this.transitionTimer += dt;
      this.transitionProgress = Math.min(1, this.transitionTimer / this.transitionDuration);
    }

    // Wind varies
    this.windStrength = 0.5 + Math.sin(gameTime * 0.4) * 0.3 + Math.sin(gameTime * 1.1) * 0.2;

    // Rain
    const rainIntensity = this._getRainIntensity();
    this.rainMaterial.opacity = rainIntensity * 0.5;

    if (rainIntensity > 0) {
      for (let i = 0; i < RAIN_COUNT; i++) {
        const i3 = i * 3;
        this.rainPositions[i3 + 1] -= this.rainVelocities[i] * dt;
        this.rainPositions[i3] += this.windStrength * this.windDirection.x * dt * 4;
        this.rainPositions[i3 + 2] += this.windStrength * this.windDirection.z * dt * 4;

        if (this.rainPositions[i3 + 1] < -1) {
          this.rainPositions[i3] = playerPos.x + (Math.random() - 0.5) * RAIN_AREA;
          this.rainPositions[i3 + 1] = playerPos.y + RAIN_HEIGHT + Math.random() * 5;
          this.rainPositions[i3 + 2] = playerPos.z + (Math.random() - 0.5) * RAIN_AREA;
        }
      }
      this.rainMesh.geometry.attributes.position.needsUpdate = true;
    }

    // Lightning (storm only)
    this.lightningFlash = Math.max(0, this.lightningFlash - dt * 8);
    this.lightningLight.intensity = this.lightningFlash * 3;

    if (this.state === "storm" && this.transitionProgress > 0.5) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningFlash = 1.0;
        this.lightningLight.position.set(
          playerPos.x + (Math.random() - 0.5) * 80,
          45 + Math.random() * 20,
          playerPos.z + (Math.random() - 0.5) * 80
        );
        this.lightningTimer = 3 + Math.random() * 8;
        // Queue thunder sound (delayed)
        this.thunderQueue.push(gameTime + 0.3 + Math.random() * 1.5);
      }
    }

    // Fog adjustments
    const fogDensity = this._getFogDensity();
    const baseFogFar = CONFIG.world.fog.far;
    const baseFogNear = CONFIG.world.fog.near;
    this.scene.fog.far = baseFogFar - fogDensity * (baseFogFar * 0.5);
    this.scene.fog.near = baseFogNear - fogDensity * (baseFogNear * 0.4);

    // Check thunder queue
    const thunderReady = [];
    for (let i = this.thunderQueue.length - 1; i >= 0; i--) {
      if (gameTime >= this.thunderQueue[i]) {
        thunderReady.push(true);
        this.thunderQueue.splice(i, 1);
      }
    }

    return {
      state: this.state,
      rainIntensity,
      thunderReady: thunderReady.length > 0,
      lightningFlash: this.lightningFlash,
    };
  }

  getSaveState() {
    return {
      state: this.state,
      nextChangeAt: this.nextChangeAt,
    };
  }

  applySaveState(data) {
    if (!data) return;
    if (STATES.includes(data.state)) this.state = data.state;
    if (typeof data.nextChangeAt === "number") this.nextChangeAt = data.nextChangeAt;
    this.previousState = this.state;
    this.transitionProgress = 1;
  }
}
