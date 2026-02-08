import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";
import { createTacticalRifleModel } from "./weaponModels.js";
import { GAME_CONFIG } from "./config.js";

export class PlayerController {
  constructor(camera, getHeightAt, options = {}) {
    this.camera = camera;
    this.getHeightAt = getHeightAt;
    this.getHeightAtDetailed = options.getHeightAtDetailed || getHeightAt;
    this.resolveHorizontalCollision =
      typeof options.resolveHorizontalCollision === "function"
        ? options.resolveHorizontalCollision
        : null;
    this.getCameraTuningForPosition =
      typeof options.getCameraTuningForPosition === "function"
        ? options.getCameraTuningForPosition
        : null;
    this.constrainCameraPosition =
      typeof options.constrainCameraPosition === "function"
        ? options.constrainCameraPosition
        : null;
    this.options = options;
    this.characterConfig = GAME_CONFIG.character;

    this.position = new THREE.Vector3(0, 6, 0);
    this.velocity = new THREE.Vector3();
    this.moveDir = new THREE.Vector3();

    this.speed = 8;
    this.sprintSpeed = 13;
    this.jumpPower = 9;
    this.gravity = 24;
    this.height = 1.6;
    this.onGround = false;

    this.yaw = 0;
    this.pitch = -0.2;
    this.visualYaw = 0;
    this.lookSensitivity = 1;

    this.keys = new Set();
    this.prevJumpDown = false;

    this.cameraConfig = {
      distance: 6.8,
      aimDistance: 3.4,
      minDistance: 1.25,
      height: 2.6,
      lookHeight: 1.6,
      shoulderOffset: 1.05,
      positionLerp: 12,
      aimPositionLerp: 16,
      minPitch: -1.05,
      maxPitch: 0.72,
      collisionPadding: 0.25,
    };
    this.shoulderSide = 1;
    this.isAiming = false;

    this.cameraCollisionMeshes = Array.isArray(options.cameraCollisionMeshes)
      ? options.cameraCollisionMeshes
      : [];
    this.cameraRay = new THREE.Raycaster();

    this.walkCycle = 0;
    this.moveBlend = 0;
    this.groundStickDistance = 0.35;
    this.groundDrag = this.characterConfig.movement.groundDrag;
    this.elapsed = 0;
    this.locomotionState = "idle";
    this.previousLocomotionState = "idle";
    this.locomotionStateTime = 0;
    this.stateBlend = 1;
    this.landingRecoverUntil = 0;
    this.aimBlend = 0;
    this.fireRecoil = 0;
    this.cameraKick = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
    };
    this.cameraLandingImpulse = 0;
    this.cameraSway = { x: 0, y: 0 };
    this.lastCameraKickProfile = "default";
    this.recoilPatternState = new Map();
    this.recoilPatterns = {
      default: [
        { x: 0.0, y: 1.0 },
        { x: 0.25, y: 1.08 },
        { x: -0.2, y: 1.16 },
        { x: 0.18, y: 1.22 },
      ],
      rifle: [
        { x: 0.08, y: 1.0 },
        { x: 0.2, y: 1.08 },
        { x: -0.12, y: 1.14 },
        { x: 0.16, y: 1.2 },
        { x: -0.18, y: 1.24 },
      ],
      smg: [
        { x: 0.18, y: 0.72 },
        { x: -0.16, y: 0.76 },
        { x: 0.22, y: 0.8 },
        { x: -0.2, y: 0.84 },
        { x: 0.16, y: 0.88 },
        { x: -0.12, y: 0.92 },
      ],
      shotgun: [
        { x: 0.05, y: 1.28 },
        { x: -0.04, y: 1.18 },
        { x: 0.03, y: 1.1 },
      ],
      sniper: [
        { x: 0.01, y: 1.8 },
        { x: -0.01, y: 1.65 },
      ],
      flamethrower: [
        { x: 0.1, y: 0.34 },
        { x: -0.08, y: 0.36 },
        { x: 0.07, y: 0.38 },
        { x: -0.06, y: 0.4 },
      ],
    };
    this.lastRecoilPatternIndex = 0;
    this.punchState = {
      active: false,
      hand: "right",
      startAt: 0,
      hitAt: 0,
      endAt: 0,
      cooldownUntil: 0,
    };

    const avatar = this._createAvatar(options.scene);
    this.avatarRoot = avatar.root;
    this.avatarParts = avatar.parts;
    this.avatarRoot.position.copy(this.position).add(new THREE.Vector3(0, -this.height, 0));
    this.weaponRig = this._createWeaponRig();

    this._setupInput();
  }

  _createWeaponRig() {
    const gun = createTacticalRifleModel({
      color: 0x2f343f,
      accent: 0x10151e,
      scale: 0.78,
    });

    const mount = new THREE.Group();
    mount.position.set(0.38, 1.36, 0.16);
    mount.rotation.set(-0.14, -0.02, -0.15);
    mount.add(gun.root);

    gun.root.rotation.set(0.05, 0, 0);
    this.avatarRoot.add(mount);

    return {
      mount,
      root: gun.root,
      muzzle: gun.muzzle,
    };
  }

  _createAvatar(scene) {
    const root = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x2f4c88,
      roughness: 0.75,
      metalness: 0.05,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0x1b1f29,
      roughness: 0.85,
      metalness: 0.05,
    });
    const skinMat = new THREE.MeshStandardMaterial({
      color: 0xf0c7a1,
      roughness: 0.9,
      metalness: 0,
    });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.8, 6, 10), bodyMat);
    torso.position.set(0, 1.2, 0);
    torso.castShadow = true;
    torso.receiveShadow = true;

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 14), skinMat);
    head.position.set(0, 1.95, 0);
    head.castShadow = true;

    const shoulderL = new THREE.Group();
    shoulderL.position.set(-0.34, 1.55, 0);
    const shoulderR = new THREE.Group();
    shoulderR.position.set(0.34, 1.55, 0);

    const armUpperGeo = new THREE.CapsuleGeometry(0.08, 0.32, 4, 8);
    const armLowerGeo = new THREE.CapsuleGeometry(0.07, 0.28, 4, 8);

    const armUpperL = new THREE.Mesh(armUpperGeo, accentMat);
    armUpperL.position.set(0, -0.2, 0);
    armUpperL.castShadow = true;

    const armUpperR = new THREE.Mesh(armUpperGeo, accentMat);
    armUpperR.position.set(0, -0.2, 0);
    armUpperR.castShadow = true;

    const forearmL = new THREE.Group();
    forearmL.position.set(0, -0.38, 0);
    const forearmR = new THREE.Group();
    forearmR.position.set(0, -0.38, 0);

    const armLowerL = new THREE.Mesh(armLowerGeo, skinMat);
    armLowerL.position.set(0, -0.16, 0);
    armLowerL.castShadow = true;

    const armLowerR = new THREE.Mesh(armLowerGeo, skinMat);
    armLowerR.position.set(0, -0.16, 0);
    armLowerR.castShadow = true;

    const hipL = new THREE.Group();
    hipL.position.set(-0.17, 0.78, 0);
    const hipR = new THREE.Group();
    hipR.position.set(0.17, 0.78, 0);

    const legUpperGeo = new THREE.CapsuleGeometry(0.1, 0.46, 4, 8);
    const legLowerGeo = new THREE.CapsuleGeometry(0.09, 0.42, 4, 8);

    const thighL = new THREE.Mesh(legUpperGeo, accentMat);
    thighL.position.set(0, -0.28, 0);
    thighL.castShadow = true;

    const thighR = new THREE.Mesh(legUpperGeo, accentMat);
    thighR.position.set(0, -0.28, 0);
    thighR.castShadow = true;

    const shinL = new THREE.Group();
    shinL.position.set(0, -0.56, 0);
    const shinR = new THREE.Group();
    shinR.position.set(0, -0.56, 0);

    const calfL = new THREE.Mesh(legLowerGeo, bodyMat);
    calfL.position.set(0, -0.22, 0.02);
    calfL.castShadow = true;

    const calfR = new THREE.Mesh(legLowerGeo, bodyMat);
    calfR.position.set(0, -0.22, 0.02);
    calfR.castShadow = true;

    shoulderL.add(armUpperL, forearmL);
    shoulderR.add(armUpperR, forearmR);
    forearmL.add(armLowerL);
    forearmR.add(armLowerR);

    hipL.add(thighL, shinL);
    hipR.add(thighR, shinR);
    shinL.add(calfL);
    shinR.add(calfR);

    root.add(torso, head, shoulderL, shoulderR, hipL, hipR);

    root.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.castShadow = true;
      obj.receiveShadow = true;
    });

    if (scene) scene.add(root);
    return {
      root,
      parts: {
        torso,
        shoulderL,
        shoulderR,
        forearmL,
        forearmR,
        hipL,
        hipR,
        shinL,
        shinR,
      },
    };
  }

  _setupInput() {
    window.addEventListener("keydown", (e) => this.keys.add(e.code));
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));

    window.addEventListener("mousemove", (e) => {
      if (document.pointerLockElement) {
        this.yaw -= e.movementX * 0.0025 * this.lookSensitivity;
        this.pitch -= e.movementY * 0.002 * this.lookSensitivity;
        this.pitch = Math.max(this.cameraConfig.minPitch, Math.min(this.cameraConfig.maxPitch, this.pitch));
      }
    });

    window.addEventListener("mousedown", (e) => {
      if (e.button === 2 && document.pointerLockElement) {
        this.isAiming = true;
      }
    });

    window.addEventListener("mouseup", (e) => {
      if (e.button === 2) {
        this.isAiming = false;
      }
    });

    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyV") {
        this.shoulderSide *= -1;
      }
    });
  }

  setLookSensitivity(multiplier) {
    this.lookSensitivity = Math.max(0.2, Number(multiplier) || 1);
  }

  setPosition(x, y, z) {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.avatarRoot.position.copy(this.position).add(new THREE.Vector3(0, -this.height, 0));
  }

  tryStartPunch(time) {
    if (time < this.punchState.cooldownUntil) return null;
    this.punchState.active = true;
    this.punchState.hand = this.punchState.hand === "right" ? "left" : "right";
    this.punchState.startAt = time;
    this.punchState.hitAt = time + 0.12;
    this.punchState.endAt = time + 0.42;
    this.punchState.cooldownUntil = time + 0.58;

    return {
      hitAt: this.punchState.hitAt,
      endAt: this.punchState.endAt,
    };
  }

  getPunchQuery(targetOrigin = new THREE.Vector3(), targetDirection = new THREE.Vector3()) {
    targetOrigin.copy(this.position).add(new THREE.Vector3(0, 1.3, 0));
    targetDirection.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).normalize();
    return { origin: targetOrigin, direction: targetDirection };
  }

  getPositionArray() {
    return [this.position.x, this.position.y, this.position.z];
  }

  getAimOrigin(target = new THREE.Vector3()) {
    return target.copy(this.position).add(new THREE.Vector3(0, this.cameraConfig.lookHeight, 0));
  }

  getAimDirection(target = new THREE.Vector3()) {
    return target
      .set(
        Math.sin(this.yaw) * Math.cos(this.pitch),
        Math.sin(this.pitch),
        Math.cos(this.yaw) * Math.cos(this.pitch)
      )
      .normalize();
  }

  getMuzzleOrigin(target = new THREE.Vector3()) {
    if (this.weaponRig && this.weaponRig.muzzle) {
      return this.weaponRig.muzzle.getWorldPosition(target);
    }

    const forward = this.getAimDirection(new THREE.Vector3());
    const right = new THREE.Vector3(forward.z, 0, -forward.x).normalize();
    return target
      .copy(this.position)
      .add(new THREE.Vector3(0, 1.45, 0))
      .add(right.multiplyScalar(0.45 * this.shoulderSide))
      .add(forward.multiplyScalar(0.45));
  }

  _updateVisual(dt, hasMoveInput) {
    this.avatarRoot.position.copy(this.position).add(new THREE.Vector3(0, -this.height, 0));
    if (hasMoveInput) {
      const targetYaw = Math.atan2(this.moveDir.x, this.moveDir.z);
      let delta = targetYaw - this.visualYaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      this.visualYaw += delta * Math.min(1, dt * 14);
    }
    this.avatarRoot.rotation.y = this.visualYaw;

    if (!this.avatarParts) return;

    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const speedNorm = Math.min(1, horizontalSpeed / Math.max(0.001, this.sprintSpeed));
    const stateBlendSpeed = 7;
    this.stateBlend = Math.min(1, this.stateBlend + dt * stateBlendSpeed);

    const stateProfiles = {
      idle: { torsoLean: 0, armSwing: 0.06, legSwing: 0.28, weaponDrop: 0, weaponRoll: 0.02 },
      walk: { torsoLean: 0.02, armSwing: 0.14, legSwing: 0.45, weaponDrop: 0.006, weaponRoll: 0.03 },
      jog: { torsoLean: 0.05, armSwing: 0.2, legSwing: 0.62, weaponDrop: 0.012, weaponRoll: 0.038 },
      sprint: { torsoLean: 0.11, armSwing: 0.24, legSwing: 0.82, weaponDrop: 0.02, weaponRoll: 0.048 },
      jump: { torsoLean: 0.08, armSwing: 0.1, legSwing: 0.2, weaponDrop: 0.016, weaponRoll: 0.028 },
      fall: { torsoLean: 0.06, armSwing: 0.08, legSwing: 0.16, weaponDrop: 0.014, weaponRoll: 0.022 },
      land: { torsoLean: 0.12, armSwing: 0.08, legSwing: 0.24, weaponDrop: 0.02, weaponRoll: 0.02 },
      aim_idle: { torsoLean: 0.01, armSwing: 0.02, legSwing: 0.12, weaponDrop: -0.01, weaponRoll: 0.012 },
      aim_move: { torsoLean: 0.04, armSwing: 0.08, legSwing: 0.28, weaponDrop: -0.006, weaponRoll: 0.018 },
    };
    const stateProfile = stateProfiles[this.locomotionState] || stateProfiles.idle;
    const priorProfile = stateProfiles[this.previousLocomotionState] || stateProfiles.idle;
    const blend = this.stateBlend;
    const lerpState = (key) => THREE.MathUtils.lerp(priorProfile[key], stateProfile[key], blend);

    const stateArmSwing = lerpState("armSwing");
    const stateLegSwing = lerpState("legSwing");
    const stateTorsoLean = lerpState("torsoLean");
    const stateWeaponDrop = lerpState("weaponDrop");
    const stateWeaponRoll = lerpState("weaponRoll");
    const moveTarget = hasMoveInput ? 1 : 0;
    this.moveBlend +=
      (moveTarget - this.moveBlend) * Math.min(1, dt * this.characterConfig.animation.locomotionBlendSpeed);
    this.aimBlend +=
      ((this.isAiming ? 1 : 0) - this.aimBlend) * Math.min(1, dt * this.characterConfig.animation.aimBlendSpeed);
    this.fireRecoil = Math.max(0, this.fireRecoil - dt * 6.5);

    this.walkCycle +=
      dt *
      (this.characterConfig.animation.walkCycleBase +
        horizontalSpeed * this.characterConfig.animation.walkCycleSpeedFactor) *
      (0.25 + this.moveBlend * 1.2);

    const swing = Math.sin(this.walkCycle) * (0.45 + stateLegSwing) * this.moveBlend;
    const kneeBendL = Math.max(0, Math.sin(this.walkCycle + Math.PI * 0.5)) * 0.4 * this.moveBlend;
    const kneeBendR = Math.max(0, Math.sin(this.walkCycle + Math.PI * 1.5)) * 0.4 * this.moveBlend;

    const armSwing = swing * (0.1 + stateArmSwing);
    const aimDownSights = this.aimBlend;
    const holdBlend = 0.65 + aimDownSights * 0.35;
    const punch = this.punchState;
    const punchT = punch.active
      ? Math.max(0, Math.min(1, (this.elapsed - punch.startAt) / Math.max(0.001, punch.endAt - punch.startAt)))
      : 0;
    const punchWave = punch.active ? Math.sin(punchT * Math.PI) : 0;
    const isRightPunch = punch.hand === "right";

    this.avatarParts.shoulderR.rotation.x =
      -0.92 * holdBlend + armSwing + (isRightPunch ? punchWave * 0.95 : 0) - this.fireRecoil * 0.12;
    this.avatarParts.shoulderR.rotation.y = -0.12;
    this.avatarParts.shoulderR.rotation.z = -0.08;
    this.avatarParts.forearmR.rotation.x = -0.58 * holdBlend + armSwing * 0.5 + (isRightPunch ? punchWave * 0.45 : 0);

    this.avatarParts.shoulderL.rotation.x =
      -0.76 * holdBlend - armSwing + (!isRightPunch ? punchWave * 0.95 : 0) - this.fireRecoil * 0.08;
    this.avatarParts.shoulderL.rotation.y = 0.26;
    this.avatarParts.shoulderL.rotation.z = 0.15;
    this.avatarParts.forearmL.rotation.x = -0.94 * holdBlend - armSwing * 0.35 + (!isRightPunch ? punchWave * 0.45 : 0);

    this.avatarParts.hipL.rotation.x = -swing - stateTorsoLean * 0.12;
    this.avatarParts.hipR.rotation.x = swing - stateTorsoLean * 0.12;
    this.avatarParts.shinL.rotation.x = kneeBendL;
    this.avatarParts.shinR.rotation.x = kneeBendR;

    const torsoYawTarget =
      THREE.MathUtils.clamp(this.yaw - this.visualYaw, -0.6, 0.6) * (0.2 + this.aimBlend * 0.7) - stateTorsoLean;
    this.avatarParts.torso.rotation.y +=
      (torsoYawTarget - this.avatarParts.torso.rotation.y) *
      Math.min(1, dt * this.characterConfig.animation.torsoYawFollow);

    const landingCompression =
      this.elapsed < this.landingRecoverUntil
        ? (1 - (this.landingRecoverUntil - this.elapsed) / this.characterConfig.animation.landingRecoverSeconds) * 0.12
        : 0;

    this.avatarParts.torso.position.y =
      1.2 + Math.sin(this.walkCycle * 2) * this.characterConfig.animation.bobAmplitude * this.moveBlend - landingCompression;

    if (this.weaponRig) {
      const aimPitchOffset = this.pitch * 0.25;
      const sprintOffset = this.locomotionState === "sprint" ? 0.08 : 0;
      this.weaponRig.mount.rotation.x = -0.14 + aimPitchOffset + sprintOffset - this.fireRecoil * 0.25 - stateWeaponDrop;
      this.weaponRig.mount.rotation.z =
        -0.15 +
        Math.sin(this.walkCycle) * (this.characterConfig.animation.weaponSwayAmplitude + stateWeaponRoll) * this.moveBlend;
      this.weaponRig.mount.position.y =
        1.36 +
        Math.sin(this.walkCycle * 2) *
          this.characterConfig.animation.weaponBobAmplitude *
          this.moveBlend -
        stateWeaponDrop;

      this.weaponRig.mount.position.z = 0.16 - this.aimBlend * 0.05 - (this.locomotionState === "sprint" ? 0.06 : 0);
    }
  }

  _resolveLocomotionState({ hasMoveInput, canSprint, speedNorm, landed }) {
    const wasAir = this.locomotionState === "jump" || this.locomotionState === "fall";
    if (!this.onGround) {
      return this.velocity.y > 0.25 ? "jump" : "fall";
    }

    if (landed || (wasAir && this.onGround)) {
      return "land";
    }

    if (this.elapsed < this.landingRecoverUntil) {
      return "land";
    }

    if (this.isAiming) {
      return hasMoveInput ? "aim_move" : "aim_idle";
    }

    if (!hasMoveInput || speedNorm < this.characterConfig.movement.walkSpeedThreshold) return "idle";
    if (canSprint || speedNorm >= this.characterConfig.movement.sprintSpeedThreshold) return "sprint";
    if (speedNorm >= this.characterConfig.movement.jogSpeedThreshold) return "jog";
    return "walk";
  }

  notifyWeaponFired(intensity = 1, profileName = "default") {
    const profiles = this.characterConfig.camera.recoilProfiles || {};
    const profile = profiles[profileName] || profiles.default || { recoil: 0.38, camKick: 1, yawJitter: 1 };
    this.lastCameraKickProfile = profileName;

    const recoilScale = Math.max(0.05, profile.recoil || 0.38);
    this.fireRecoil = Math.min(1.4, this.fireRecoil + Math.max(0, Number(intensity) || 0) * recoilScale);

    const kickScale = this.characterConfig.camera.weaponKickScale;
    const maxKick = this.characterConfig.camera.maxKick;
    const camKickScale = Math.max(0.05, profile.camKick || 1);
    const yawJitterScale = Math.max(0.05, profile.yawJitter || 1);

    const pattern = this.recoilPatterns[profileName] || this.recoilPatterns.default;
    const state = this.recoilPatternState.get(profileName) || { index: 0, lastAt: -999 };
    if (this.elapsed - state.lastAt > 0.34) {
      state.index = 0;
    }
    const patternPoint = pattern[state.index % pattern.length];
    this.lastRecoilPatternIndex = state.index % pattern.length;
    state.index += 1;
    state.lastAt = this.elapsed;
    this.recoilPatternState.set(profileName, state);

    const deterministicKickY = intensity * kickScale * camKickScale * (patternPoint.y || 1);
    const deterministicKickX = kickScale * yawJitterScale * (patternPoint.x || 0);
    this.cameraKick.vy -= Math.min(maxKick, Math.max(0.004, deterministicKickY));
    this.cameraKick.vx += deterministicKickX;
  }

  _updateCamera(dt) {
    const cfg = this.cameraConfig;
    const tuning = this.getCameraTuningForPosition
      ? this.getCameraTuningForPosition(this.position)
      : null;
    const distanceMul = tuning?.distanceMultiplier ?? 1;
    const shoulderMul = tuning?.shoulderMultiplier ?? 1;
    const collisionPadding = tuning?.collisionPadding ?? cfg.collisionPadding;

    const cameraDistance = (this.isAiming ? cfg.aimDistance : cfg.distance) * distanceMul;
    const shoulder = cfg.shoulderOffset * this.shoulderSide * shoulderMul;

    const up = new THREE.Vector3(0, 1, 0);
    const forward = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch)
    ).normalize();

    const right = new THREE.Vector3().crossVectors(forward, up).normalize();

    const pivot = this.position.clone().add(new THREE.Vector3(0, cfg.height, 0));
    const swayAmp = this.characterConfig.camera.swayAmplitude;
    const swayFreq = this.characterConfig.camera.swayFrequency;
    const gait = Math.min(1, Math.hypot(this.velocity.x, this.velocity.z) / Math.max(0.001, this.sprintSpeed));
    const moveSwayScale = this.moveBlend * this.moveBlend * gait * (this.isAiming ? 0.14 : 0.34);
    const targetSwayX = Math.sin(this.walkCycle * swayFreq) * swayAmp * moveSwayScale;
    const targetSwayY = Math.cos(this.walkCycle * swayFreq * 0.5) * swayAmp * 0.45 * moveSwayScale;
    const swayLerp = 1 - Math.exp(-10 * dt);
    this.cameraSway.x += (targetSwayX - this.cameraSway.x) * swayLerp;
    this.cameraSway.y += (targetSwayY - this.cameraSway.y) * swayLerp;

    const spring = this.characterConfig.camera.springStiffness;
    const damping =
      this.characterConfig.camera.springDamping *
      (this.isAiming ? this.characterConfig.camera.adsDampingMultiplier || 1.25 : 1);
    this.cameraKick.vx += (-this.cameraKick.x * spring - this.cameraKick.vx * damping) * dt;
    this.cameraKick.vy += (-this.cameraKick.y * spring - this.cameraKick.vy * damping) * dt;
    this.cameraKick.x += this.cameraKick.vx * dt;
    this.cameraKick.y += this.cameraKick.vy * dt;

    this.cameraLandingImpulse = Math.max(
      0,
      this.cameraLandingImpulse - dt * this.characterConfig.camera.kickRecovery
    );

    const camPitchOffset = this.cameraSway.y + this.cameraKick.y - this.cameraLandingImpulse;
    const camYawOffset = this.cameraSway.x + this.cameraKick.x;
    const lookForward = new THREE.Vector3(
      Math.sin(this.yaw + camYawOffset) * Math.cos(this.pitch + camPitchOffset),
      Math.sin(this.pitch + camPitchOffset),
      Math.cos(this.yaw + camYawOffset) * Math.cos(this.pitch + camPitchOffset)
    ).normalize();

    const lookTarget = pivot.clone().add(lookForward.multiplyScalar(36));

    const desiredOffset = forward
      .clone()
      .multiplyScalar(-cameraDistance)
      .add(right.multiplyScalar(shoulder));
    const desiredCameraPos = pivot.clone().add(desiredOffset);

    const rayDir = desiredCameraPos.clone().sub(pivot);
    const rayLen = rayDir.length();
    if (rayLen > 0.0001 && this.cameraCollisionMeshes.length > 0) {
      this.cameraRay.set(pivot, rayDir.normalize());
      this.cameraRay.far = rayLen;
      const hits = this.cameraRay.intersectObjects(this.cameraCollisionMeshes, false);
      if (hits.length > 0) {
        const safeDist = Math.max(cfg.minDistance, hits[0].distance - collisionPadding);
        desiredCameraPos.copy(pivot).add(rayDir.multiplyScalar(safeDist));
      }
    }

    if (this.constrainCameraPosition) {
      this.constrainCameraPosition(desiredCameraPos, pivot, this.position);
    }

    const lerpSpeed = this.isAiming ? cfg.aimPositionLerp : cfg.positionLerp;
    this.camera.position.lerp(desiredCameraPos, 1 - Math.exp(-lerpSpeed * dt));
    this.camera.lookAt(lookTarget);
  }

  update(dt) {
    this.elapsed += dt;
    let landed = false;
    let fallSpeed = 0;

    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = new THREE.Vector3(forward.z, 0, -forward.x);

    this.moveDir.set(0, 0, 0);
    if (this.keys.has("KeyW")) this.moveDir.add(forward);
    if (this.keys.has("KeyS")) this.moveDir.sub(forward);
    if (this.keys.has("KeyD")) this.moveDir.add(right);
    if (this.keys.has("KeyA")) this.moveDir.sub(right);

    if (this.moveDir.lengthSq() > 0) this.moveDir.normalize();

    const wantsSprint = this.keys.has("ShiftLeft");
    const hasMoveInput = this.moveDir.lengthSq() > 0;
    const canSprint = this.options.canSprint
      ? this.options.canSprint(dt, wantsSprint && hasMoveInput)
      : wantsSprint;
    const targetSpeed = canSprint ? this.sprintSpeed : this.speed;
    const targetVX = this.moveDir.x * targetSpeed;
    const targetVZ = this.moveDir.z * targetSpeed;

    const accel = this.onGround ? this.characterConfig.movement.accelGround : this.characterConfig.movement.accelAir;
    this.velocity.x += (targetVX - this.velocity.x) * Math.min(1, accel * dt);
    this.velocity.z += (targetVZ - this.velocity.z) * Math.min(1, accel * dt);
    if (!hasMoveInput && this.onGround) {
      const drag = Math.min(1, this.groundDrag * dt);
      this.velocity.x *= 1 - drag;
      this.velocity.z *= 1 - drag;
    }

    const jumpDown = this.keys.has("Space");
    const jumpPressed = jumpDown && !this.prevJumpDown;
    if (this.onGround && jumpPressed) {
      const canJump = this.options.consumeJumpCost
        ? this.options.consumeJumpCost()
        : true;
      if (canJump) {
        this.velocity.y = this.jumpPower;
        this.onGround = false;
      }
    }
    this.prevJumpDown = jumpDown;

    this.velocity.y -= this.gravity * dt;
    this.position.addScaledVector(this.velocity, dt);

    if (this.resolveHorizontalCollision) {
      this.resolveHorizontalCollision(
        this.position,
        0.42,
        this.position.y - this.height,
        this.position.y + 0.25
      );
    }

    const groundY = this.getHeightAtDetailed(this.position.x, this.position.z, this.position.y - this.height) + this.height;
    const preClampYVel = this.velocity.y;
    const aboveGround = this.position.y - groundY;

    if (this.position.y <= groundY) {
      if (!this.onGround) {
        landed = true;
        fallSpeed = Math.max(0, -preClampYVel);
        this.landingRecoverUntil = this.elapsed + this.characterConfig.animation.landingRecoverSeconds;
        const landingScale = this.characterConfig.camera.landingImpulseScale;
        const landingMax = this.characterConfig.camera.landingImpulseMax;
        this.cameraLandingImpulse = Math.min(landingMax, this.cameraLandingImpulse + fallSpeed * landingScale);
      }
      this.position.y = groundY;
      this.velocity.y = 0;
      this.onGround = true;
    } else if (preClampYVel <= 0 && aboveGround <= this.groundStickDistance) {
      this.position.y = groundY;
      this.velocity.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    const maxWorld = 107;
    this.position.x = Math.max(-maxWorld, Math.min(maxWorld, this.position.x));
    this.position.z = Math.max(-maxWorld, Math.min(maxWorld, this.position.z));

    const speedNorm = Math.min(1, Math.hypot(this.velocity.x, this.velocity.z) / Math.max(0.001, this.sprintSpeed));
    const nextLocomotion = this._resolveLocomotionState({
      hasMoveInput,
      canSprint,
      speedNorm,
      landed,
    });
    if (nextLocomotion !== this.locomotionState) {
      this.previousLocomotionState = this.locomotionState;
      this.locomotionState = nextLocomotion;
      this.locomotionStateTime = 0;
      this.stateBlend = 0;
    } else {
      this.locomotionStateTime += dt;
    }

    this._updateVisual(dt, hasMoveInput);
    this._updateCamera(dt);

    if (this.punchState.active && this.elapsed >= this.punchState.endAt) {
      this.punchState.active = false;
    }

    return {
      landed,
      fallSpeed,
      sprinting: canSprint,
      hasMoveInput,
      isAiming: this.isAiming,
      locomotionState: this.locomotionState,
      previousLocomotionState: this.previousLocomotionState,
      locomotionStateTime: this.locomotionStateTime,
      locomotionBlend: this.stateBlend,
      speedNormalized: speedNorm,
      cameraKickX: this.cameraKick.x,
      cameraKickY: this.cameraKick.y,
      cameraLandingImpulse: this.cameraLandingImpulse,
      cameraKickProfile: this.lastCameraKickProfile,
      recoilPatternIndex: this.lastRecoilPatternIndex,
    };
  }
}
