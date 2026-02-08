import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const VEHICLE_ARCHETYPES = {
  sedan: {
    name: "Sedan",
    color: 0xb62525,
    hoodColor: 0xa82020,
    cabinColor: 0x2e394a,
    bodyLength: 4.45,
    bodyWidth: 1.82,
    bodyHeight: 0.58,
    maxForwardSpeed: 19,
    maxReverseSpeed: 7,
    acceleration: 24,
    reverseAcceleration: 16,
    steerRate: 2.6,
    drag: 0.3,
  },
  scout: {
    name: "Scout",
    color: 0x2d7db8,
    hoodColor: 0x2b6c9b,
    cabinColor: 0x31414e,
    bodyLength: 4.05,
    bodyWidth: 1.74,
    bodyHeight: 0.54,
    maxForwardSpeed: 24,
    maxReverseSpeed: 8,
    acceleration: 30,
    reverseAcceleration: 18,
    steerRate: 2.95,
    drag: 0.28,
  },
  muscle: {
    name: "Muscle",
    color: 0x9840bf,
    hoodColor: 0x7f32a2,
    cabinColor: 0x2b2a33,
    bodyLength: 4.68,
    bodyWidth: 1.88,
    bodyHeight: 0.56,
    maxForwardSpeed: 27,
    maxReverseSpeed: 8,
    acceleration: 28,
    reverseAcceleration: 17,
    steerRate: 2.45,
    drag: 0.27,
  },
  truck: {
    name: "Truck",
    color: 0x4e7f3a,
    hoodColor: 0x436c32,
    cabinColor: 0x38414a,
    bodyLength: 5.1,
    bodyWidth: 2.02,
    bodyHeight: 0.72,
    maxForwardSpeed: 16,
    maxReverseSpeed: 6,
    acceleration: 19,
    reverseAcceleration: 13,
    steerRate: 2.05,
    drag: 0.34,
  },
};

export class VehicleSystem {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.vehicles = [];
  }

  spawnDefault() {
    const spawnList = [
      { id: "car_0", archetype: "sedan", x: 0, z: 10 },
      { id: "car_1", archetype: "scout", x: -14, z: 12 },
      { id: "car_2", archetype: "muscle", x: 16, z: 9 },
      { id: "car_3", archetype: "truck", x: 5, z: 24 },
    ];
    for (const spec of spawnList) {
      const vehicle = this._createVehicle(spec);
      this.vehicles.push(vehicle);
    }
  }

  _createVehicle({ id, archetype = "sedan", x, z }) {
    const style = VEHICLE_ARCHETYPES[archetype] || VEHICLE_ARCHETYPES.sedan;
    const root = new THREE.Group();
    const wheels = [];
    const frontWheelIndices = [0, 1];

    const bodyLength = style.bodyLength;
    const bodyWidth = style.bodyWidth;
    const bodyHeight = style.bodyHeight;

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(bodyWidth, bodyHeight, bodyLength),
      new THREE.MeshStandardMaterial({ color: style.color, roughness: 0.62, metalness: 0.26 })
    );
    body.position.y = 0.92;

    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.56, 0.74, 2.2),
      new THREE.MeshStandardMaterial({ color: style.cabinColor, roughness: 0.36, metalness: 0.32 })
    );
    cabin.position.set(0, 1.46, -0.05);

    const hood = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 0.24, 1.2),
      new THREE.MeshStandardMaterial({ color: style.hoodColor, roughness: 0.58, metalness: 0.3 })
    );
    hood.position.set(0, 1.07, bodyLength * 0.29);

    const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.22, 14);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x191919, roughness: 0.9, metalness: 0.18 });
    const wheelOffsets = [
      [-0.76, 0.34, 1.32],
      [0.76, 0.34, 1.32],
      [-0.76, 0.34, -1.24],
      [0.76, 0.34, -1.24],
    ];
    for (const [wx, wy, wz] of wheelOffsets) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI * 0.5;
      wheel.position.set(wx, wy, wz);
      wheels.push(wheel);
      root.add(wheel);
    }

    const headlightMat = new THREE.MeshStandardMaterial({
      color: 0xfff3ce,
      emissive: 0xffe39d,
      emissiveIntensity: 0.8,
      roughness: 0.25,
      metalness: 0.15,
    });
    const headlightGeo = new THREE.BoxGeometry(0.18, 0.12, 0.1);
    const headlightL = new THREE.Mesh(headlightGeo, headlightMat);
    const headlightR = new THREE.Mesh(headlightGeo, headlightMat);
    headlightL.position.set(-0.62, 0.95, bodyLength * 0.5 + 0.03);
    headlightR.position.set(0.62, 0.95, bodyLength * 0.5 + 0.03);

    const headlightBeamL = new THREE.PointLight(0xffefc8, 0.55, 16, 1.7);
    const headlightBeamR = new THREE.PointLight(0xffefc8, 0.55, 16, 1.7);
    headlightBeamL.position.copy(headlightL.position).add(new THREE.Vector3(0, 0, 0.35));
    headlightBeamR.position.copy(headlightR.position).add(new THREE.Vector3(0, 0, 0.35));

    root.add(body, cabin, hood, headlightL, headlightR, headlightBeamL, headlightBeamR);

    root.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.castShadow = true;
      obj.receiveShadow = true;
    });

    const y = this.world.getHeightAtDetailed(x, z, this.world.getHeightAt(x, z)) + 0.1;
    root.position.set(x, y, z);
    this.scene.add(root);

    return {
      id,
      archetype,
      label: style.name,
      mesh: root,
      wheels,
      frontWheelIndices,
      headlightMeshes: [headlightL, headlightR],
      headlightLights: [headlightBeamL, headlightBeamR],
      headlightsOn: true,
      speed: 0,
      yaw: 0,
      steerVisual: 0,
      wasBraking: false,
      velocity: new THREE.Vector3(),
      driftState: {
        active: false,
        intensity: 0,
        slip: 0,
        surfaceGrip: 1,
      },
      config: {
        maxForwardSpeed: style.maxForwardSpeed,
        maxReverseSpeed: style.maxReverseSpeed,
        acceleration: style.acceleration,
        reverseAcceleration: style.reverseAcceleration,
        brakeDecel: 34,
        rollFriction: 7.2,
        drag: style.drag,
        steerRate: style.steerRate,
        steerVisualRate: 10,
        maxSteerAngle: 0.48,
        highSpeedSteerReduction: 0.45,
        gripBase: 0.94,
        gripBrake: 0.84,
        driftGrip: 0.72,
        handbrakeYawImpulse: 0.09,
      },
    };
  }

  getById(id) {
    return this.vehicles.find((v) => v.id === id) || null;
  }

  getNearestVehicle(position, maxDistance = 3.2) {
    let best = null;
    let bestDist = Infinity;
    for (const v of this.vehicles) {
      const d = v.mesh.position.distanceTo(position);
      if (d < bestDist && d <= maxDistance) {
        best = v;
        bestDist = d;
      }
    }
    return best;
  }

  getForwardVector(vehicle, target = new THREE.Vector3()) {
    return target.set(Math.sin(vehicle.yaw), 0, Math.cos(vehicle.yaw)).normalize();
  }

  setHeadlights(vehicle, enabled) {
    if (!vehicle) return;
    const on = Boolean(enabled);
    vehicle.headlightsOn = on;
    for (const light of vehicle.headlightLights || []) {
      light.visible = on;
      light.intensity = on ? 0.55 : 0;
    }
    for (const mesh of vehicle.headlightMeshes || []) {
      if (!mesh.material) continue;
      mesh.material.emissiveIntensity = on ? 0.8 : 0.05;
    }
  }

  toggleHeadlights(vehicle) {
    if (!vehicle) return false;
    this.setHeadlights(vehicle, !vehicle.headlightsOn);
    return vehicle.headlightsOn;
  }

  update(dt, controlsByVehicleId = null) {
    for (const vehicle of this.vehicles) {
      const controls = controlsByVehicleId ? controlsByVehicleId(vehicle.id) : null;
      this._updateVehicle(vehicle, dt, controls);
    }
  }

  _updateVehicle(vehicle, dt, controls) {
    const c = vehicle.config;
    const throttle = controls ? clamp(controls.throttle || 0, -1, 1) : 0;
    const steer = controls ? clamp(controls.steer || 0, -1, 1) : 0;
    const braking = Boolean(controls && controls.brake);
    const boosting = Boolean(controls && controls.boost);

    const forwardSpeedCap = boosting ? c.maxForwardSpeed * 1.75 : c.maxForwardSpeed;
    const accelScale = boosting ? 1.95 : 1;

    if (throttle > 0) {
      vehicle.speed += c.acceleration * accelScale * throttle * dt;
    } else if (throttle < 0) {
      vehicle.speed += c.reverseAcceleration * throttle * dt;
    }

    if (braking) {
      if (vehicle.speed > 0) vehicle.speed = Math.max(0, vehicle.speed - c.brakeDecel * dt);
      else vehicle.speed = Math.min(0, vehicle.speed + c.brakeDecel * dt);
    } else {
      const friction = c.rollFriction * dt;
      if (vehicle.speed > 0) vehicle.speed = Math.max(0, vehicle.speed - friction);
      else vehicle.speed = Math.min(0, vehicle.speed + friction);
      vehicle.speed *= 1 - c.drag * dt;
    }

    vehicle.speed = clamp(vehicle.speed, -c.maxReverseSpeed, forwardSpeedCap);

    const speedNorm = clamp(Math.abs(vehicle.speed) / Math.max(0.001, c.maxForwardSpeed), 0, 1);
    const steerFactor = Math.min(1, Math.abs(vehicle.speed) / 2.4);
    const steeringInputFactor = Math.max(0.28, steerFactor);

    const targetSteerVisual = steer * c.maxSteerAngle * steeringInputFactor;
    vehicle.steerVisual += (targetSteerVisual - vehicle.steerVisual) * Math.min(1, c.steerVisualRate * dt);

    if (braking && !vehicle.wasBraking && Math.abs(vehicle.speed) > 4.8 && Math.abs(steer) > 0.15) {
      const directionSign = vehicle.speed >= 0 ? 1 : -1;
      vehicle.yaw += steer * c.handbrakeYawImpulse * directionSign;
    }

    if (Math.abs(vehicle.speed) > 0.15) {
      const directionSign = vehicle.speed >= 0 ? 1 : -1;
      const speedSteerScale = 1 - speedNorm * (1 - c.highSpeedSteerReduction);
      vehicle.yaw += steer * c.steerRate * steerFactor * speedSteerScale * directionSign * dt;
    }

    const forward = this.getForwardVector(vehicle);

    let grip = braking ? c.gripBrake : c.gripBase;
    const surfaceGrip = this.world.getSurfaceGripAt
      ? clamp(this.world.getSurfaceGripAt(vehicle.mesh.position.x, vehicle.mesh.position.z), 0.55, 1.05)
      : 1;
    const drifting = braking && Math.abs(steer) > 0.25 && Math.abs(vehicle.speed) > 6;
    if (drifting) grip = c.driftGrip;
    grip *= surfaceGrip;

    const velocity = forward.clone().multiplyScalar(vehicle.speed);
    vehicle.velocity.lerp(velocity, Math.min(1, grip * dt * 8));
    vehicle.mesh.position.addScaledVector(vehicle.velocity, dt);

    const right = new THREE.Vector3(forward.z, 0, -forward.x).normalize();
    const longitudinal = Math.abs(vehicle.velocity.dot(forward));
    const lateral = Math.abs(vehicle.velocity.dot(right));
    const slip = longitudinal > 0.2 ? clamp(lateral / longitudinal, 0, 2) : 0;
    const driftIntensity = clamp(
      (drifting ? 0.45 : 0) +
        slip * 0.35 +
        Math.max(0, 1 - surfaceGrip) * 0.75 +
        Math.abs(steer) * 0.12,
      0,
      1
    );
    vehicle.driftState.active = drifting || driftIntensity > 0.24;
    vehicle.driftState.intensity = driftIntensity;
    vehicle.driftState.slip = slip;
    vehicle.driftState.surfaceGrip = surfaceGrip;
    vehicle.wasBraking = braking;

    const maxWorld = this.world.worldSize * 0.5 - 2;
    vehicle.mesh.position.x = clamp(vehicle.mesh.position.x, -maxWorld, maxWorld);
    vehicle.mesh.position.z = clamp(vehicle.mesh.position.z, -maxWorld, maxWorld);

    if (this.world.resolveHorizontalCollision) {
      this.world.resolveHorizontalCollision(
        vehicle.mesh.position,
        0.85,
        vehicle.mesh.position.y,
        vehicle.mesh.position.y + 1.8
      );
    }

    const y = this.world.getHeightAtDetailed(
      vehicle.mesh.position.x,
      vehicle.mesh.position.z,
      this.world.getHeightAt(vehicle.mesh.position.x, vehicle.mesh.position.z)
    );
    vehicle.mesh.position.y = y + 0.06;
    vehicle.mesh.rotation.y = vehicle.yaw;

    if (vehicle.wheels && vehicle.wheels.length > 0) {
      const wheelSpin = (vehicle.speed * dt) / 0.34;
      for (let i = 0; i < vehicle.wheels.length; i++) {
        const wheel = vehicle.wheels[i];
        wheel.rotation.x += wheelSpin;
        if (vehicle.frontWheelIndices && vehicle.frontWheelIndices.includes(i)) {
          wheel.rotation.y = vehicle.steerVisual;
        }
      }
    }
  }

  getSaveState() {
    return this.vehicles.map((v) => ({
      id: v.id,
      archetype: v.archetype,
      x: v.mesh.position.x,
      y: v.mesh.position.y,
      z: v.mesh.position.z,
      yaw: v.yaw,
      speed: v.speed,
    }));
  }

  applySaveState(savedList = []) {
    if (!Array.isArray(savedList)) return;
    const map = new Map(savedList.map((v) => [v.id, v]));
    for (const vehicle of this.vehicles) {
      const saved = map.get(vehicle.id);
      if (!saved) continue;
      vehicle.mesh.position.set(
        Number(saved.x) || vehicle.mesh.position.x,
        Number(saved.y) || vehicle.mesh.position.y,
        Number(saved.z) || vehicle.mesh.position.z
      );
      vehicle.yaw = Number(saved.yaw) || 0;
      vehicle.speed = Number(saved.speed) || 0;
      vehicle.mesh.rotation.y = vehicle.yaw;
      vehicle.wasBraking = false;
      vehicle.velocity.set(0, 0, 0);
      vehicle.driftState.active = false;
      vehicle.driftState.intensity = 0;
      vehicle.driftState.slip = 0;
      vehicle.driftState.surfaceGrip = 1;
    }
  }
}
