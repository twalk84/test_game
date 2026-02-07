import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";

export class CollectibleSystem {
  constructor(scene, getHeightAt, worldSize = 220) {
    this.scene = scene;
    this.getHeightAt = getHeightAt;
    this.worldSize = worldSize;
    this.items = [];
    this.collectedIds = new Set();
    this.definitionById = new Map();
  }

  spawn(count = 40) {
    const rareGeom = new THREE.OctahedronGeometry(0.62, 0);
    const commonGeom = new THREE.IcosahedronGeometry(0.45, 0);
    const healGeom = new THREE.TetrahedronGeometry(0.5, 0);

    for (let i = 0; i < count; i++) {
      const id = `c_${i}`;
      const roll = Math.random();
      let type = "common";
      if (roll > 0.92) type = "heal";
      else if (roll > 0.75) type = "rare";

      const config = {
        common: {
          score: 1,
          xp: 10,
          respawn: 18,
          emissive: 0x332200,
          color: new THREE.Color().setHSL(0.13 + Math.random() * 0.18, 0.8, 0.56),
          geom: commonGeom,
          inventory: { scrap: 1, crystal: 0, medkit: 0 },
        },
        rare: {
          score: 3,
          xp: 28,
          respawn: 30,
          emissive: 0x1f1f44,
          color: new THREE.Color().setHSL(0.55 + Math.random() * 0.08, 0.78, 0.62),
          geom: rareGeom,
          inventory: { scrap: 0, crystal: 2, medkit: 0 },
        },
        heal: {
          score: 2,
          xp: 14,
          heal: 12,
          respawn: 24,
          emissive: 0x13331a,
          color: new THREE.Color().setHSL(0.32 + Math.random() * 0.06, 0.75, 0.58),
          geom: healGeom,
          inventory: { scrap: 0, crystal: 0, medkit: 1 },
        },
      }[type];

      const mat = new THREE.MeshStandardMaterial({
        color: config.color,
        emissive: config.emissive,
        roughness: 0.35,
        metalness: 0.15,
      });

      const mesh = new THREE.Mesh(config.geom, mat);
      const x = (Math.random() - 0.5) * (this.worldSize - 24);
      const z = (Math.random() - 0.5) * (this.worldSize - 24);
      const y = this.getHeightAt(x, z) + 1.1;

      mesh.position.set(x, y, z);
      mesh.castShadow = true;

      this.scene.add(mesh);
      this.items.push({
        id,
        mesh,
        type,
        score: config.score,
        xp: config.xp,
        heal: config.heal || 0,
        inventory: config.inventory,
        respawnAt: 0,
        respawnDelay: config.respawn,
        phase: Math.random() * Math.PI * 2,
      });
      this.definitionById.set(id, {
        type,
        score: config.score,
        xp: config.xp,
        heal: config.heal || 0,
        inventory: config.inventory,
      });
    }
  }

  update(time, playerPos) {
    const rewards = {
      count: 0,
      score: 0,
      xp: 0,
      heal: 0,
      rareCount: 0,
      inventory: {
        scrap: 0,
        crystal: 0,
        medkit: 0,
      },
    };

    for (const item of this.items) {
      if (this.collectedIds.has(item.id)) {
        if (item.respawnAt > 0 && time >= item.respawnAt) {
          this.collectedIds.delete(item.id);
          item.respawnAt = 0;
          if (!this.scene.children.includes(item.mesh)) {
            this.scene.add(item.mesh);
          }
        }
        continue;
      }

      const m = item.mesh;
      m.position.y += Math.sin(time * 2 + item.phase) * 0.003;
      m.rotation.y += 0.02;

      if (m.position.distanceTo(playerPos) < 1.5) {
        this.collectedIds.add(item.id);
        item.respawnAt = time + item.respawnDelay;
        this.scene.remove(m);
        rewards.count += 1;
        rewards.score += item.score;
        rewards.xp += item.xp;
        rewards.heal += item.heal;
        rewards.inventory.scrap += item.inventory?.scrap || 0;
        rewards.inventory.crystal += item.inventory?.crystal || 0;
        rewards.inventory.medkit += item.inventory?.medkit || 0;
        if (item.type === "rare") rewards.rareCount += 1;
      }
    }
    return rewards;
  }

  applyCollectedList(collectedIdsArray = []) {
    this.collectedIds = new Set(collectedIdsArray);
    for (const item of this.items) {
      if (this.collectedIds.has(item.id)) {
        if (!item.respawnAt) item.respawnAt = 5 + Math.random() * 8;
        this.scene.remove(item.mesh);
      } else if (!this.scene.children.includes(item.mesh)) {
        item.respawnAt = 0;
        this.scene.add(item.mesh);
      }
    }
  }

  getCollectedList() {
    return [...this.collectedIds];
  }
}