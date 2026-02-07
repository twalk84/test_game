import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";
import { createTacticalRifleModel } from "./weaponModels.js";

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
    this.groundDrag = 7;
    this.elapsed = 0;
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
    const moveTarget = hasMoveInput ? 1 : 0;
    this.moveBlend += (moveTarget - this.moveBlend) * Math.min(1, dt * 10);
    this.walkCycle += dt * (2.1 + horizontalSpeed * 1.05) * (0.25 + this.moveBlend * 1.2);

    const swing = Math.sin(this.walkCycle) * 0.68 * this.moveBlend;
    const kneeBendL = Math.max(0, Math.sin(this.walkCycle + Math.PI * 0.5)) * 0.4 * this.moveBlend;
    const kneeBendR = Math.max(0, Math.sin(this.walkCycle + Math.PI * 1.5)) * 0.4 * this.moveBlend;

    const armSwing = swing * 0.22;
    const aimDownSights = this.isAiming ? 1 : 0;
    const holdBlend = 0.65 + aimDownSights * 0.35;
    const punch = this.punchState;
    const punchT = punch.active
      ? Math.max(0, Math.min(1, (this.elapsed - punch.startAt) / Math.max(0.001, punch.endAt - punch.startAt)))
      : 0;
    const punchWave = punch.active ? Math.sin(punchT * Math.PI) : 0;
    const isRightPunch = punch.hand === "right";

    this.avatarParts.shoulderR.rotation.x = -0.92 * holdBlend + armSwing + (isRightPunch ? punchWave * 0.95 : 0);
    this.avatarParts.shoulderR.rotation.y = -0.12;
    this.avatarParts.shoulderR.rotation.z = -0.08;
    this.avatarParts.forearmR.rotation.x = -0.58 * holdBlend + armSwing * 0.5 + (isRightPunch ? punchWave * 0.45 : 0);

    this.avatarParts.shoulderL.rotation.x = -0.76 * holdBlend - armSwing + (!isRightPunch ? punchWave * 0.95 : 0);
    this.avatarParts.shoulderL.rotation.y = 0.26;
    this.avatarParts.shoulderL.rotation.z = 0.15;
    this.avatarParts.forearmL.rotation.x = -0.94 * holdBlend - armSwing * 0.35 + (!isRightPunch ? punchWave * 0.45 : 0);

    this.avatarParts.hipL.rotation.x = -swing;
    this.avatarParts.hipR.rotation.x = swing;
    this.avatarParts.shinL.rotation.x = kneeBendL;
    this.avatarParts.shinR.rotation.x = kneeBendR;

    this.avatarParts.torso.position.y = 1.2 + Math.sin(this.walkCycle * 2) * 0.03 * this.moveBlend;

    if (this.weaponRig) {
      const aimPitchOffset = this.pitch * 0.25;
      const sprintOffset = hasMoveInput && this.keys.has("ShiftLeft") ? 0.08 : 0;
      this.weaponRig.mount.rotation.x = -0.14 + aimPitchOffset + sprintOffset;
      this.weaponRig.mount.rotation.z = -0.15 + Math.sin(this.walkCycle) * 0.02 * this.moveBlend;
      this.weaponRig.mount.position.y = 1.36 + Math.sin(this.walkCycle * 2) * 0.015 * this.moveBlend;
    }
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
    const lookTarget = pivot.clone().add(forward.clone().multiplyScalar(36));

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

    const accel = this.onGround ? 12 : 4;
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
    };
  }
}
