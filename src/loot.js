import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";
import { CONFIG } from "./config.js";

const LOOT = CONFIG.loot;

export class LootSystem {
  constructor(scene, getHeightAt) {
    this.scene = scene;
    this.getHeightAt = getHeightAt;
    this.drops = [];

    // Shared geometry for all loot drops
    this.geo = new THREE.OctahedronGeometry(0.3, 0);
  }

  _pickLootType() {
    const types = LOOT.types;
    const roll = Math.random();
    let cumulative = 0;
    for (const [key, cfg] of Object.entries(types)) {
      cumulative += cfg.chance;
      if (roll <= cumulative) return key;
    }
    return "health";
  }

  tryDrop(position, gameTime) {
    if (Math.random() > LOOT.dropChance) return;

    const type = this._pickLootType();
    const cfg = LOOT.types[type];

    const mat = new THREE.MeshStandardMaterial({
      color: cfg.color,
      emissive: cfg.color,
      emissiveIntensity: 0.4,
      roughness: 0.4,
      metalness: 0.3,
    });

    const mesh = new THREE.Mesh(this.geo, mat);
    const y = this.getHeightAt(position.x, position.z);
    mesh.position.set(position.x, y + 1.0, position.z);
    mesh.castShadow = true;
    this.scene.add(mesh);

    this.drops.push({
      mesh,
      type,
      spawnTime: gameTime,
      baseY: y + 1.0,
    });
  }

  update(gameTime, playerPos) {
    const result = { pickedUp: null };

    for (let i = this.drops.length - 1; i >= 0; i--) {
      const drop = this.drops[i];

      // Despawn check
      if (gameTime - drop.spawnTime > LOOT.despawnTime) {
        this._removeDrop(i);
        continue;
      }

      // Bob and rotate animation
      const age = gameTime - drop.spawnTime;
      drop.mesh.position.y = drop.baseY + Math.sin(age * LOOT.bobSpeed) * LOOT.bobHeight;
      drop.mesh.rotation.y = age * 2.0;

      // Pickup check
      const dx = drop.mesh.position.x - playerPos.x;
      const dz = drop.mesh.position.z - playerPos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < LOOT.pickupRadius) {
        result.pickedUp = {
          type: drop.type,
          config: LOOT.types[drop.type],
        };
        this._removeDrop(i);
        break;
      }
    }

    return result;
  }

  _removeDrop(index) {
    const drop = this.drops[index];
    drop.mesh.material.dispose();
    this.scene.remove(drop.mesh);
    this.drops.splice(index, 1);
  }

  cleanup() {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      this._removeDrop(i);
    }
  }
}
