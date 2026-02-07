import { CONFIG } from "./config.js";

const WORLD_HALF = CONFIG.world.size / 2;

// Biome definitions — each region has center, radius, and modifiers
const BIOMES = {
  forest: {
    label: "Forest",
    center: { x: 0, z: 0 },
    radius: 45,
    fogColor: 0x7aa4d6,
    fogNearMul: 1.0,
    fogFarMul: 1.0,
    enemyHealthMul: 1.0,
    enemyDamageMul: 1.0,
    enemySpeedMul: 1.0,
    lootChanceMul: 1.0,
    ambientTint: { r: 0.24, g: 0.5, b: 0.27 },
  },
  desert: {
    label: "Desert",
    center: { x: WORLD_HALF * 0.55, z: -WORLD_HALF * 0.55 },
    radius: 40,
    fogColor: 0xc4a862,
    fogNearMul: 1.2,
    fogFarMul: 0.85,
    enemyHealthMul: 0.9,
    enemyDamageMul: 1.3,
    enemySpeedMul: 1.1,
    lootChanceMul: 0.8,
    ambientTint: { r: 0.7, g: 0.6, b: 0.35 },
  },
  swamp: {
    label: "Swamp",
    center: { x: -WORLD_HALF * 0.55, z: WORLD_HALF * 0.55 },
    radius: 38,
    fogColor: 0x3a5540,
    fogNearMul: 0.6,
    fogFarMul: 0.65,
    enemyHealthMul: 1.1,
    enemyDamageMul: 1.0,
    enemySpeedMul: 0.85,
    lootChanceMul: 1.4,
    ambientTint: { r: 0.22, g: 0.33, b: 0.22 },
  },
  mountains: {
    label: "Mountains",
    center: { x: -WORLD_HALF * 0.5, z: -WORLD_HALF * 0.5 },
    radius: 42,
    fogColor: 0x8899aa,
    fogNearMul: 0.9,
    fogFarMul: 1.1,
    enemyHealthMul: 1.5,
    enemyDamageMul: 1.2,
    enemySpeedMul: 0.9,
    lootChanceMul: 1.2,
    ambientTint: { r: 0.48, g: 0.48, b: 0.45 },
  },
};

const BIOME_KEYS = Object.keys(BIOMES);

export class BiomeSystem {
  constructor() {
    this.currentBiome = "forest";
    this.blendWeight = 1; // 0..1 how strongly in the biome
  }

  getBiomeAt(x, z) {
    let closest = "forest";
    let closestDist = Infinity;

    for (const key of BIOME_KEYS) {
      const b = BIOMES[key];
      const dx = x - b.center.x;
      const dz = z - b.center.z;
      const dist = Math.hypot(dx, dz);
      const normalized = dist / b.radius;
      if (normalized < closestDist) {
        closestDist = normalized;
        closest = key;
      }
    }

    return {
      biome: closest,
      weight: Math.max(0, Math.min(1, 1 - closestDist + 0.3)),
      data: BIOMES[closest],
    };
  }

  update(playerX, playerZ) {
    const result = this.getBiomeAt(playerX, playerZ);
    this.currentBiome = result.biome;
    this.blendWeight = result.weight;
    return result;
  }

  getEnemyModifiers() {
    const b = BIOMES[this.currentBiome];
    const w = this.blendWeight;
    return {
      healthMul: 1 + (b.enemyHealthMul - 1) * w,
      damageMul: 1 + (b.enemyDamageMul - 1) * w,
      speedMul: 1 + (b.enemySpeedMul - 1) * w,
    };
  }

  getLootChanceMultiplier() {
    const b = BIOMES[this.currentBiome];
    return 1 + (b.lootChanceMul - 1) * this.blendWeight;
  }

  getCurrentLabel() {
    return BIOMES[this.currentBiome].label;
  }
}
