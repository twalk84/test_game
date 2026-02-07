import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";

export class PlayerController {
  constructor(camera, getHeightAt, options = {}) {
    this.camera = camera;
    this.getHeightAt = getHeightAt;
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

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.74, 6, 10), bodyMat);
    torso.position.set(0, 1.05, 0);
    torso.castShadow = true;
    torso.receiveShadow = true;

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 14), skinMat);
    head.position.set(0, 1.78, 0);
    head.castShadow = true;

    const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.23, 0.7, 6, 10), accentMat);
    legs.position.set(0, 0.42, 0);
    legs.castShadow = true;
    legs.receiveShadow = true;

    root.add(legs, torso, head);
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

  setPosition(x, y, z) {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
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

  _updateVisual(dt, hasMoveInput) {
    this.avatarRoot.position.copy(this.position);
    if (hasMoveInput) {
      const targetYaw = Math.atan2(this.moveDir.x, this.moveDir.z);
      let delta = targetYaw - this.visualYaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      this.visualYaw += delta * Math.min(1, dt * 14);
    }
    this.avatarRoot.rotation.y = this.visualYaw;
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

    const maxWorld = 107;
    this.position.x = Math.max(-maxWorld, Math.min(maxWorld, this.position.x));
    this.position.z = Math.max(-maxWorld, Math.min(maxWorld, this.position.z));

    this._updateVisual(dt, hasMoveInput);
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
