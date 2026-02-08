import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";
import { CONFIG } from "./config.js";

export class PlayerController {
  constructor(camera, getHeightAt, options = {}) {
    this.camera = camera;
    this.getHeightAt = getHeightAt;
    this.options = options;

    this.position = new THREE.Vector3(0, 6, 0);
    this.velocity = new THREE.Vector3();
    this.moveDir = new THREE.Vector3();
    this.impulse = new THREE.Vector3();

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

    this.avatarRoot = this._createAvatar(options.scene);
    this.avatarRoot.position.copy(this.position);

    this._setupInput();
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
    const bootMat = new THREE.MeshStandardMaterial({
      color: 0x3d2b1f,
      roughness: 0.9,
      metalness: 0,
    });

    // Torso
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.30, 0.60, 6, 10), bodyMat);
    torso.position.set(0, 1.10, 0);
    torso.castShadow = true;
    torso.receiveShadow = true;

    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 14), skinMat);
    head.position.set(0, 1.78, 0);
    head.castShadow = true;

    // Left leg pivot (at hip)
    this.leftLegPivot = new THREE.Group();
    this.leftLegPivot.position.set(-0.14, 0.72, 0);
    const leftUpperLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.10, 0.34, 5, 8), accentMat);
    leftUpperLeg.position.set(0, -0.22, 0);
    leftUpperLeg.castShadow = true;
    const leftLowerLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.30, 5, 8), accentMat);
    leftLowerLeg.position.set(0, -0.55, 0);
    leftLowerLeg.castShadow = true;
    const leftBoot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.24), bootMat);
    leftBoot.position.set(0, -0.76, 0.04);
    leftBoot.castShadow = true;
    this.leftLegPivot.add(leftUpperLeg, leftLowerLeg, leftBoot);

    // Right leg pivot (at hip)
    this.rightLegPivot = new THREE.Group();
    this.rightLegPivot.position.set(0.14, 0.72, 0);
    const rightUpperLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.10, 0.34, 5, 8), accentMat);
    rightUpperLeg.position.set(0, -0.22, 0);
    rightUpperLeg.castShadow = true;
    const rightLowerLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.30, 5, 8), accentMat);
    rightLowerLeg.position.set(0, -0.55, 0);
    rightLowerLeg.castShadow = true;
    const rightBoot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.24), bootMat);
    rightBoot.position.set(0, -0.76, 0.04);
    rightBoot.castShadow = true;
    this.rightLegPivot.add(rightUpperLeg, rightLowerLeg, rightBoot);

    // Left arm pivot (at shoulder)
    this.leftArmPivot = new THREE.Group();
    this.leftArmPivot.position.set(-0.38, 1.38, 0);
    const leftUpperArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.28, 5, 8), bodyMat);
    leftUpperArm.position.set(0, -0.20, 0);
    leftUpperArm.castShadow = true;
    const leftForearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.24, 5, 8), skinMat);
    leftForearm.position.set(0, -0.46, 0);
    leftForearm.castShadow = true;
    const leftHand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), skinMat);
    leftHand.position.set(0, -0.62, 0);
    this.leftArmPivot.add(leftUpperArm, leftForearm, leftHand);

    // Right arm pivot (at shoulder)
    this.rightArmPivot = new THREE.Group();
    this.rightArmPivot.position.set(0.38, 1.38, 0);
    const rightUpperArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.28, 5, 8), bodyMat);
    rightUpperArm.position.set(0, -0.20, 0);
    rightUpperArm.castShadow = true;
    const rightForearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.24, 5, 8), skinMat);
    rightForearm.position.set(0, -0.46, 0);
    rightForearm.castShadow = true;
    const rightHand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), skinMat);
    rightHand.position.set(0, -0.62, 0);
    this.rightArmPivot.add(rightUpperArm, rightForearm, rightHand);

    this.walkCycle = 0;

    root.add(this.leftLegPivot, this.rightLegPivot, torso, head, this.leftArmPivot, this.rightArmPivot);
    if (scene) scene.add(root);
    return root;
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

  addImpulse(vec) {
    this.impulse.add(vec);
  }

  setPosition(x, y, z) {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.impulse.set(0, 0, 0);
    this.avatarRoot.position.copy(this.position);
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
    const forward = this.getAimDirection(new THREE.Vector3());
    const right = new THREE.Vector3(forward.z, 0, -forward.x).normalize();
    return target
      .copy(this.position)
      .add(new THREE.Vector3(0, 1.45, 0))
      .add(right.multiplyScalar(0.45 * this.shoulderSide))
      .add(forward.multiplyScalar(0.45));
  }

  _updateVisual(dt, hasMoveInput, sprinting) {
    this.avatarRoot.position.copy(this.position);
    if (hasMoveInput) {
      const targetYaw = Math.atan2(this.moveDir.x, this.moveDir.z);
      let delta = targetYaw - this.visualYaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      this.visualYaw += delta * Math.min(1, dt * 14);
    }
    this.avatarRoot.rotation.y = this.visualYaw;

    // Walk cycle animation
    if (hasMoveInput) {
      const walkSpeed = sprinting ? 12 : 8;
      this.walkCycle += dt * walkSpeed;
      const swing = Math.sin(this.walkCycle);
      const swingAmp = sprinting ? 0.6 : 0.4;
      const armAmp = sprinting ? 0.5 : 0.3;

      // Legs swing opposite to each other
      this.leftLegPivot.rotation.x = swing * swingAmp;
      this.rightLegPivot.rotation.x = -swing * swingAmp;

      // Arms swing opposite to legs (natural walk)
      this.leftArmPivot.rotation.x = -swing * armAmp;
      this.rightArmPivot.rotation.x = swing * armAmp;
    } else {
      // Smoothly return to idle
      this.walkCycle = 0;
      this.leftLegPivot.rotation.x *= 0.85;
      this.rightLegPivot.rotation.x *= 0.85;
      this.leftArmPivot.rotation.x *= 0.85;
      this.rightArmPivot.rotation.x *= 0.85;
    }
  }

  _updateCamera(dt) {
    const cfg = this.cameraConfig;
    const cameraDistance = this.isAiming ? cfg.aimDistance : cfg.distance;
    const shoulder = cfg.shoulderOffset * this.shoulderSide;

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
        const safeDist = Math.max(cfg.minDistance, hits[0].distance - cfg.collisionPadding);
        desiredCameraPos.copy(pivot).add(rayDir.multiplyScalar(safeDist));
      }
    }

    const lerpSpeed = this.isAiming ? cfg.aimPositionLerp : cfg.positionLerp;
    this.camera.position.lerp(desiredCameraPos, 1 - Math.exp(-lerpSpeed * dt));
    this.camera.lookAt(lookTarget);
  }

  update(dt) {
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

    // Apply external impulse (knockback, dash, etc.)
    if (this.impulse.lengthSq() > 0.01) {
      this.velocity.add(this.impulse);
      this.impulse.multiplyScalar(Math.max(0, 1 - dt * 8));
    } else {
      this.impulse.set(0, 0, 0);
    }

    this.position.addScaledVector(this.velocity, dt);

    const groundY = this.getHeightAt(this.position.x, this.position.z) + this.height;
    const preClampYVel = this.velocity.y;
    if (this.position.y <= groundY) {
      if (!this.onGround) {
        landed = true;
        fallSpeed = Math.max(0, -preClampYVel);
      }
      this.position.y = groundY;
      this.velocity.y = 0;
      this.onGround = true;
    }

    const maxWorld = CONFIG.world.maxWorld;
    this.position.x = Math.max(-maxWorld, Math.min(maxWorld, this.position.x));
    this.position.z = Math.max(-maxWorld, Math.min(maxWorld, this.position.z));

    this._updateVisual(dt, hasMoveInput, canSprint);
    this._updateCamera(dt);

    return {
      landed,
      fallSpeed,
      sprinting: canSprint,
      hasMoveInput,
      isAiming: this.isAiming,
    };
  }
}
