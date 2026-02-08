export const GAME_CONFIG = Object.freeze({
  character: {
    movement: {
      walkSpeedThreshold: 0.18,
      jogSpeedThreshold: 0.52,
      sprintSpeedThreshold: 0.82,
      accelGround: 12,
      accelAir: 4,
      groundDrag: 7,
    },
    animation: {
      locomotionBlendSpeed: 10,
      aimBlendSpeed: 12,
      torsoYawFollow: 8,
      landingRecoverSeconds: 0.2,
      walkCycleBase: 2.1,
      walkCycleSpeedFactor: 1.05,
      bobAmplitude: 0.03,
      weaponBobAmplitude: 0.015,
      weaponSwayAmplitude: 0.02,
    },
    camera: {
      swayAmplitude: 0.04,
      swayFrequency: 3.4,
      springStiffness: 20,
      springDamping: 10,
      adsDampingMultiplier: 1.25,
      kickRecovery: 7,
      weaponKickScale: 0.035,
      maxKick: 0.1,
      landingImpulseScale: 0.012,
      landingImpulseMax: 0.32,
      recoilProfiles: {
        default: { recoil: 0.38, camKick: 1, yawJitter: 1 },
        rifle: { recoil: 0.38, camKick: 1, yawJitter: 1 },
        smg: { recoil: 0.28, camKick: 0.75, yawJitter: 1.4 },
        shotgun: { recoil: 0.52, camKick: 1.2, yawJitter: 1.1 },
        sniper: { recoil: 0.72, camKick: 1.8, yawJitter: 0.45 },
        flamethrower: { recoil: 0.2, camKick: 0.35, yawJitter: 0.9 },
      },
    },
  },
  save: {
    version: 5,
  },
  debug: {
    enabledByDefault: false,
    refreshInterval: 0.1,
  },
  combat: {
    flamethrower: {
      treeIgniteCooldown: 0.65,
      treeIgniteRadius: 0.85,
    },
  },
  vehicles: {
    enterRange: 3.2,
    hintRange: 2.9,
    hintCooldown: 2.8,
    drift: {
      tiers: [
        { name: "Bronze", bank: 60 },
        { name: "Silver", bank: 160 },
        { name: "Gold", bank: 320 },
        { name: "Apex", bank: 520 },
      ],
    },
  },
});
