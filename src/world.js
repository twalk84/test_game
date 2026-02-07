import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";

function terrainHeight(x, z) {
  return (
    Math.sin(x * 0.05) * 1.8 +
    Math.cos(z * 0.04) * 1.5 +
    Math.sin((x + z) * 0.02) * 1.2
  );
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function horizontalPushFromAabb(x, z, radius, box) {
  const closestX = clamp(x, box.minX, box.maxX);
  const closestZ = clamp(z, box.minZ, box.maxZ);
  const dx = x - closestX;
  const dz = z - closestZ;
  const d2 = dx * dx + dz * dz;
  if (d2 >= radius * radius) return null;

  if (d2 > 1e-8) {
    const d = Math.sqrt(d2);
    const push = radius - d;
    return { x: (dx / d) * push, z: (dz / d) * push };
  }

  const toMinX = Math.abs(x - box.minX);
  const toMaxX = Math.abs(box.maxX - x);
  const toMinZ = Math.abs(z - box.minZ);
  const toMaxZ = Math.abs(box.maxZ - z);
  const minDist = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);
  if (minDist === toMinX) return { x: -(radius + 0.001), z: 0 };
  if (minDist === toMaxX) return { x: radius + 0.001, z: 0 };
  if (minDist === toMinZ) return { x: 0, z: -(radius + 0.001) };
  return { x: 0, z: radius + 0.001 };
}

export function createWorld(scene) {
  const DAY_NIGHT_FULL_CYCLE_SECONDS = 120;
  const worldSize = 220;
  const segments = 110;
  const worldRadius = worldSize * 0.5;

  const cameraCollisionMeshes = [];
  const blockingMeshes = [];
  const blockingVolumes = [];
  const dynamicBlockingVolumes = [];
  const walkableSurfaces = [];

  const hazardZones = [
    { x: -38, z: 34, radius: 10, dps: 7 },
    { x: 45, z: -22, radius: 12, dps: 8 },
    { x: 6, z: 48, radius: 8, dps: 9 },
  ];

  const mansion = {
    x: -24,
    z: -12,
    width: 34,
    depth: 24,
    floors: 3,
    floorHeight: 4.2,
    wallThickness: 0.45,
    doorWidth: 3.8,
  };

  const doorState = {
    isOpen: false,
    openAmount: 0,
    targetOpenAmount: 0,
    maxOpenAngle: Math.PI * 0.55,
  };

  const civilians = [];

  function isNearHouseFootprint(x, z, padding = 0) {
    return (
      Math.abs(x - mansion.x) < mansion.width * 0.5 + padding &&
      Math.abs(z - mansion.z) < mansion.depth * 0.5 + padding
    );
  }

  function addFlatWalkable(minX, maxX, minZ, maxZ, y) {
    walkableSurfaces.push({ type: "flat", minX, maxX, minZ, maxZ, y });
  }

  function addRampWalkable(minX, maxX, minZ, maxZ, axis, from, to, yStart, yEnd) {
    walkableSurfaces.push({
      type: "ramp",
      minX,
      maxX,
      minZ,
      maxZ,
      axis,
      from,
      to,
      yStart,
      yEnd,
    });
  }

  function addBlockingBox(centerX, centerY, centerZ, sizeX, sizeY, sizeZ, padding = 0) {
    const hx = sizeX * 0.5 + padding;
    const hy = sizeY * 0.5 + padding;
    const hz = sizeZ * 0.5 + padding;
    blockingVolumes.push({
      minX: centerX - hx,
      maxX: centerX + hx,
      minY: centerY - hy,
      maxY: centerY + hy,
      minZ: centerZ - hz,
      maxZ: centerZ + hz,
    });
  }

  function addBlockingMesh(mesh, approxSize = null) {
    blockingMeshes.push(mesh);
    if (approxSize) {
      const sx = approxSize.x ?? approxSize.width ?? 1;
      const sy = approxSize.y ?? approxSize.height ?? 1;
      const sz = approxSize.z ?? approxSize.depth ?? 1;
      addBlockingBox(
        mesh.position.x,
        mesh.position.y,
        mesh.position.z,
        sx,
        sy,
        sz,
        0.02
      );
    }
  }

  function addDynamicBlockingVolume(getBox, isEnabled) {
    dynamicBlockingVolumes.push({ getBox, isEnabled });
  }

  function isInsideMansionXZ(x, z, padding = 0) {
    const halfW = mansion.width * 0.5;
    const halfD = mansion.depth * 0.5;
    return (
      x > mansion.x - halfW + padding &&
      x < mansion.x + halfW - padding &&
      z > mansion.z - halfD + padding &&
      z < mansion.z + halfD - padding
    );
  }

  scene.fog = new THREE.Fog(0x7aa4d6, 40, 260);

  const groundGeo = new THREE.PlaneGeometry(worldSize, worldSize, segments, segments);
  groundGeo.rotateX(-Math.PI / 2);
  const pos = groundGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, terrainHeight(x, z));
  }
  groundGeo.computeVertexNormals();

  const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshStandardMaterial({ color: 0x3d7f45, roughness: 0.95, metalness: 0.03 })
  );
  ground.receiveShadow = true;
  scene.add(ground);
  cameraCollisionMeshes.push(ground);

  const rockGeo = new THREE.DodecahedronGeometry(0.9, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 1 });

  const treeTrunkGeo = new THREE.CylinderGeometry(0.2, 0.24, 2.6, 10);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5d3a1a, roughness: 1 });
  const leafGeoLarge = new THREE.ConeGeometry(1.2, 2.3, 10);
  const leafGeoMid = new THREE.ConeGeometry(0.95, 2.0, 10);
  const leafGeoTop = new THREE.ConeGeometry(0.7, 1.7, 10);
  const leafGeoTip = new THREE.ConeGeometry(0.42, 1.15, 10);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2d6e2f, roughness: 0.9 });

  function createLayeredPineTree(x, z, y) {
    const trunk = new THREE.Mesh(treeTrunkGeo, trunkMat);
    trunk.position.set(x, y + 1.3, z);
    trunk.castShadow = true;
    trunk.receiveShadow = true;

    const sway = (Math.random() - 0.5) * 0.07;
    trunk.rotation.z = sway;

    const leafBottom = new THREE.Mesh(leafGeoLarge, leafMat);
    leafBottom.position.set(x, y + 2.35, z);
    const leafMid = new THREE.Mesh(leafGeoMid, leafMat);
    leafMid.position.set(x, y + 3.25, z);
    const leafTop = new THREE.Mesh(leafGeoTop, leafMat);
    leafTop.position.set(x, y + 4.05, z);
    const leafTip = new THREE.Mesh(leafGeoTip, leafMat);
    leafTip.position.set(x, y + 4.72, z);

    leafBottom.castShadow = true;
    leafMid.castShadow = true;
    leafTop.castShadow = true;
    leafTip.castShadow = true;

    const scale = 0.82 + Math.random() * 0.62;
    trunk.scale.setScalar(scale);
    leafBottom.scale.setScalar(scale);
    leafMid.scale.setScalar(scale);
    leafTop.scale.setScalar(scale);
    leafTip.scale.setScalar(scale);

    scene.add(trunk, leafBottom, leafMid, leafTop, leafTip);
    cameraCollisionMeshes.push(trunk, leafBottom, leafMid, leafTop, leafTip);

    addBlockingMesh(trunk, { x: 1.1 * scale, y: 3.1 * scale, z: 1.1 * scale });
  }

  function createCivilianModel() {
    const root = new THREE.Group();
    const shirtMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.8, metalness: 0.02 });
    const pantsMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.85, metalness: 0.01 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xf0c8a2, roughness: 0.9, metalness: 0 });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.8, 6, 10), shirtMat);
    torso.position.set(0, 1.2, 0);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), skinMat);
    head.position.set(0, 1.9, 0);

    const shoulderL = new THREE.Group();
    shoulderL.position.set(-0.32, 1.52, 0);
    const shoulderR = new THREE.Group();
    shoulderR.position.set(0.32, 1.52, 0);
    const forearmL = new THREE.Group();
    forearmL.position.set(0, -0.34, 0);
    const forearmR = new THREE.Group();
    forearmR.position.set(0, -0.34, 0);

    const armUpperGeo = new THREE.CapsuleGeometry(0.075, 0.3, 4, 8);
    const armLowerGeo = new THREE.CapsuleGeometry(0.065, 0.28, 4, 8);
    const armUpperL = new THREE.Mesh(armUpperGeo, shirtMat);
    const armUpperR = new THREE.Mesh(armUpperGeo, shirtMat);
    armUpperL.position.set(0, -0.17, 0);
    armUpperR.position.set(0, -0.17, 0);
    const armLowerL = new THREE.Mesh(armLowerGeo, skinMat);
    const armLowerR = new THREE.Mesh(armLowerGeo, skinMat);
    armLowerL.position.set(0, -0.15, 0);
    armLowerR.position.set(0, -0.15, 0);

    const hipL = new THREE.Group();
    hipL.position.set(-0.16, 0.76, 0);
    const hipR = new THREE.Group();
    hipR.position.set(0.16, 0.76, 0);
    const shinL = new THREE.Group();
    shinL.position.set(0, -0.55, 0);
    const shinR = new THREE.Group();
    shinR.position.set(0, -0.55, 0);

    const thighGeo = new THREE.CapsuleGeometry(0.095, 0.44, 4, 8);
    const calfGeo = new THREE.CapsuleGeometry(0.085, 0.4, 4, 8);
    const thighL = new THREE.Mesh(thighGeo, pantsMat);
    const thighR = new THREE.Mesh(thighGeo, pantsMat);
    thighL.position.set(0, -0.27, 0);
    thighR.position.set(0, -0.27, 0);
    const calfL = new THREE.Mesh(calfGeo, pantsMat);
    const calfR = new THREE.Mesh(calfGeo, pantsMat);
    calfL.position.set(0, -0.2, 0.02);
    calfR.position.set(0, -0.2, 0.02);

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

    return {
      root,
      parts: { shoulderL, shoulderR, forearmL, forearmR, hipL, hipR, shinL, shinR, torso },
    };
  }

  for (let i = 0; i < 360; i++) {
    const x = (Math.random() - 0.5) * (worldSize - 20);
    const z = (Math.random() - 0.5) * (worldSize - 20);
    const y = terrainHeight(x, z);
    if (isNearHouseFootprint(x, z, 8)) continue;

    if (Math.random() < 0.12) {
      const rock = new THREE.Mesh(rockGeo, rockMat);
      rock.position.set(x, y + 0.8, z);
      const scale = 0.7 + Math.random() * 1.2;
      rock.scale.setScalar(scale);
      rock.castShadow = true;
      rock.receiveShadow = true;
      scene.add(rock);
      cameraCollisionMeshes.push(rock);
      addBlockingMesh(rock, { x: 1.8 * scale, y: 1.8 * scale, z: 1.8 * scale });
    } else {
      createLayeredPineTree(x, z, y);
    }
  }

  const mansionGroup = new THREE.Group();
  scene.add(mansionGroup);

  const houseY = terrainHeight(mansion.x, mansion.z);
  const baseY = houseY + 0.03;
  const floorThickness = 0.32;
  const groundSurfaceY = baseY + 0.45;
  const storyHeight = mansion.floorHeight;
  const totalHeight = mansion.floors * storyHeight + 0.6;
  const halfW = mansion.width * 0.5;
  const halfD = mansion.depth * 0.5;

  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xb7ab98, roughness: 0.9, metalness: 0.02 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xe3ded3, roughness: 0.82, metalness: 0.02 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x5d4736, roughness: 0.72, metalness: 0.08 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6a4b37, roughness: 0.68, metalness: 0.04 });

  const plinth = new THREE.Mesh(new THREE.BoxGeometry(mansion.width + 4, 0.9, mansion.depth + 4), stoneMat);
  plinth.position.set(mansion.x, baseY + 0.45, mansion.z);
  plinth.receiveShadow = true;
  plinth.castShadow = true;
  mansionGroup.add(plinth);

  addFlatWalkable(mansion.x - halfW - 1.8, mansion.x + halfW + 1.8, mansion.z - halfD - 1.8, mansion.z + halfD + 1.8, baseY + 0.9);

  function floorSurfaceY(floorIndex) {
    return groundSurfaceY + floorIndex * storyHeight;
  }

  for (let floor = 0; floor < mansion.floors; floor++) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(mansion.width, floorThickness, mansion.depth), woodMat);
    const surfaceY = floorSurfaceY(floor);
    slab.position.set(mansion.x, surfaceY - floorThickness * 0.5, mansion.z);
    slab.castShadow = true;
    slab.receiveShadow = true;
    mansionGroup.add(slab);
    addFlatWalkable(mansion.x - halfW + 0.3, mansion.x + halfW - 0.3, mansion.z - halfD + 0.3, mansion.z + halfD - 0.3, surfaceY);
  }

  function addMansionSilhouette() {
    const wingMat = new THREE.MeshStandardMaterial({ color: 0xdbd5ca, roughness: 0.84, metalness: 0.02 });
    const wingH = totalHeight - 1;
    const wingZ = mansion.z + halfD + 2.4;
    const leftWing = new THREE.Mesh(new THREE.BoxGeometry(9.4, wingH, 6.2), wingMat);
    leftWing.position.set(mansion.x - halfW + 5.1, groundSurfaceY + wingH * 0.5, wingZ);
    const rightWing = new THREE.Mesh(new THREE.BoxGeometry(9.4, wingH, 6.2), wingMat);
    rightWing.position.set(mansion.x + halfW - 5.1, groundSurfaceY + wingH * 0.5, wingZ);

    const centerPortico = new THREE.Mesh(new THREE.BoxGeometry(8.6, 6.2, 4.2), wingMat);
    centerPortico.position.set(mansion.x, groundSurfaceY + 3.1, mansion.z + halfD + 2.1);

    for (const m of [leftWing, rightWing, centerPortico]) {
      m.castShadow = true;
      m.receiveShadow = true;
      mansionGroup.add(m);
      cameraCollisionMeshes.push(m);
      addBlockingMesh(m, m.geometry.parameters);
    }
  }
  addMansionSilhouette();

  function addFortniteStyleRoof() {
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x5d4736, roughness: 0.64, metalness: 0.08 });
    const topY = floorSurfaceY(mansion.floors - 1) + storyHeight + 1.35;

    const leftSlope = new THREE.Mesh(new THREE.BoxGeometry(mansion.width + 1.8, 0.9, mansion.depth * 0.72), roofMat);
    leftSlope.position.set(mansion.x, topY, mansion.z - 3.2);
    leftSlope.rotation.x = -0.44;

    const rightSlope = new THREE.Mesh(new THREE.BoxGeometry(mansion.width + 1.8, 0.9, mansion.depth * 0.72), roofMat);
    rightSlope.position.set(mansion.x, topY, mansion.z + 3.2);
    rightSlope.rotation.x = 0.44;

    const ridge = new THREE.Mesh(new THREE.BoxGeometry(mansion.width + 1.5, 0.55, 0.9), roofMat);
    ridge.position.set(mansion.x, topY + 1.52, mansion.z);

    const tower = new THREE.Mesh(new THREE.BoxGeometry(7.2, 3.8, 7.2), roofMat);
    tower.position.set(mansion.x, topY + 2.9, mansion.z - 1.4);

    for (const roofPart of [leftSlope, rightSlope, ridge, tower]) {
      roofPart.castShadow = true;
      roofPart.receiveShadow = true;
      mansionGroup.add(roofPart);
      cameraCollisionMeshes.push(roofPart);
      addBlockingMesh(roofPart, roofPart.geometry.parameters);
    }
  }
  addFortniteStyleRoof();

  function buildOuterWalls() {
    const wallH = totalHeight;
    const doorGapHalf = mansion.doorWidth * 0.5;
    const southSegW = (mansion.width - mansion.doorWidth) * 0.5;
    const yMid = groundSurfaceY + wallH * 0.5;

    const north = new THREE.Mesh(new THREE.BoxGeometry(mansion.width, wallH, mansion.wallThickness), wallMat);
    north.position.set(mansion.x, yMid, mansion.z - halfD);

    const southL = new THREE.Mesh(new THREE.BoxGeometry(southSegW, wallH, mansion.wallThickness), wallMat);
    southL.position.set(mansion.x - doorGapHalf - southSegW * 0.5, yMid, mansion.z + halfD);
    const southR = new THREE.Mesh(new THREE.BoxGeometry(southSegW, wallH, mansion.wallThickness), wallMat);
    southR.position.set(mansion.x + doorGapHalf + southSegW * 0.5, yMid, mansion.z + halfD);

    const west = new THREE.Mesh(new THREE.BoxGeometry(mansion.wallThickness, wallH, mansion.depth), wallMat);
    west.position.set(mansion.x - halfW, yMid, mansion.z);
    const east = new THREE.Mesh(new THREE.BoxGeometry(mansion.wallThickness, wallH, mansion.depth), wallMat);
    east.position.set(mansion.x + halfW, yMid, mansion.z);

    const list = [north, southL, southR, west, east];
    for (const part of list) {
      part.castShadow = true;
      part.receiveShadow = true;
      mansionGroup.add(part);
      cameraCollisionMeshes.push(part);
      addBlockingMesh(part, part.geometry.parameters);
    }
  }
  buildOuterWalls();

  const doorMat = new THREE.MeshStandardMaterial({ color: 0x7a4b2b, roughness: 0.58, metalness: 0.04 });
  const doorHeight = 3.35;
  const doorThickness = 0.12;
  const singleDoorWidth = mansion.doorWidth * 0.5;
  const doorY = groundSurfaceY + doorHeight * 0.5;
  const doorZ = mansion.z + halfD - mansion.wallThickness * 0.5 - 0.07;

  const leftDoorPivot = new THREE.Group();
  leftDoorPivot.position.set(mansion.x - singleDoorWidth * 0.5, doorY, doorZ);
  const rightDoorPivot = new THREE.Group();
  rightDoorPivot.position.set(mansion.x + singleDoorWidth * 0.5, doorY, doorZ);

  const leftDoor = new THREE.Mesh(new THREE.BoxGeometry(singleDoorWidth, doorHeight, doorThickness), doorMat);
  leftDoor.position.set(singleDoorWidth * 0.5, 0, 0);
  leftDoor.castShadow = true;
  leftDoor.receiveShadow = true;

  const rightDoor = new THREE.Mesh(new THREE.BoxGeometry(singleDoorWidth, doorHeight, doorThickness), doorMat);
  rightDoor.position.set(-singleDoorWidth * 0.5, 0, 0);
  rightDoor.castShadow = true;
  rightDoor.receiveShadow = true;

  leftDoorPivot.add(leftDoor);
  rightDoorPivot.add(rightDoor);
  mansionGroup.add(leftDoorPivot, rightDoorPivot);
  cameraCollisionMeshes.push(leftDoor, rightDoor);

  function addFrontEntryPath() {
    const stepMat = new THREE.MeshStandardMaterial({ color: 0xb7ab98, roughness: 0.9, metalness: 0.02 });
    const frontZ = mansion.z + halfD + 0.95;

    const topLanding = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.24, 2.1), stepMat);
    topLanding.position.set(mansion.x, groundSurfaceY - 0.12, frontZ + 0.15);
    topLanding.castShadow = true;
    topLanding.receiveShadow = true;
    mansionGroup.add(topLanding);

    addFlatWalkable(
      mansion.x - 2.8,
      mansion.x + 2.8,
      frontZ - 0.9,
      frontZ + 1.2,
      groundSurfaceY
    );

    const stepCount = 4;
    const runStart = frontZ + 1.2;
    const runEnd = frontZ + 4.4;
    const bottomY = baseY + 0.9;
    for (let i = 0; i < stepCount; i++) {
      const t = i / (stepCount - 1);
      const y = groundSurfaceY - t * (groundSurfaceY - bottomY);
      const z = runStart + t * (runEnd - runStart);
      const step = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.2, 0.8), stepMat);
      step.position.set(mansion.x, y - 0.1, z);
      step.castShadow = true;
      step.receiveShadow = true;
      mansionGroup.add(step);
    }

    addRampWalkable(
      mansion.x - 2.6,
      mansion.x + 2.6,
      runStart - 0.4,
      runEnd + 0.4,
      "z",
      runStart,
      runEnd,
      groundSurfaceY,
      bottomY
    );
  }
  addFrontEntryPath();

  addDynamicBlockingVolume(
    () => ({
      minX: mansion.x - mansion.doorWidth * 0.5,
      maxX: mansion.x + mansion.doorWidth * 0.5,
      minY: groundSurfaceY,
      maxY: groundSurfaceY + doorHeight,
      minZ: doorZ - doorThickness * 0.7,
      maxZ: doorZ + doorThickness * 0.7,
    }),
    () => doorState.openAmount < 0.2
  );

  function addInteriorWalls() {
    const corridorW = 4.3;
    const wallLen = mansion.depth - 2.4;

    for (let floor = 0; floor < mansion.floors; floor++) {
      const y = floorSurfaceY(floor) + storyHeight * 0.5;
      const left = new THREE.Mesh(
        new THREE.BoxGeometry(mansion.wallThickness, storyHeight - 0.2, wallLen),
        wallMat
      );
      left.position.set(mansion.x - corridorW * 0.5, y, mansion.z);

      const right = new THREE.Mesh(
        new THREE.BoxGeometry(mansion.wallThickness, storyHeight - 0.2, wallLen),
        wallMat
      );
      right.position.set(mansion.x + corridorW * 0.5, y, mansion.z);

      const backDivider = new THREE.Mesh(
        new THREE.BoxGeometry(mansion.width - 4.5, storyHeight - 0.2, mansion.wallThickness),
        wallMat
      );
      backDivider.position.set(mansion.x, y, mansion.z - halfD * 0.25);

      for (const m of [left, right, backDivider]) {
        m.castShadow = true;
        m.receiveShadow = true;
        mansionGroup.add(m);
        addBlockingMesh(m, m.geometry.parameters);
      }
    }
  }
  addInteriorWalls();

  function addColumnsAndFurniture() {
    const columnMat = new THREE.MeshStandardMaterial({ color: 0xd7d2c8, roughness: 0.8, metalness: 0.03 });
    const tableMat = new THREE.MeshStandardMaterial({ color: 0x5a3d2b, roughness: 0.7, metalness: 0.04 });
    const sofaMat = new THREE.MeshStandardMaterial({ color: 0x4d5d66, roughness: 0.9, metalness: 0.01 });
    const chairMat = new THREE.MeshStandardMaterial({ color: 0x7b6148, roughness: 0.74, metalness: 0.04 });
    const bedMat = new THREE.MeshStandardMaterial({ color: 0x6a7487, roughness: 0.9, metalness: 0.01 });
    const pillowMat = new THREE.MeshStandardMaterial({ color: 0xe8e6df, roughness: 0.95, metalness: 0.01 });

    const columnGeo = new THREE.CylinderGeometry(0.22, 0.24, totalHeight - 0.4, 12);
    const columnOffsets = [
      [-halfW + 1.2, -halfD + 1.2],
      [halfW - 1.2, -halfD + 1.2],
      [-halfW + 1.2, halfD - 1.2],
      [halfW - 1.2, halfD - 1.2],
    ];
    for (const [ox, oz] of columnOffsets) {
      const column = new THREE.Mesh(columnGeo, columnMat);
      column.position.set(mansion.x + ox, groundSurfaceY + (totalHeight - 0.4) * 0.5, mansion.z + oz);
      column.castShadow = true;
      column.receiveShadow = true;
      mansionGroup.add(column);
      addBlockingMesh(column, { x: 0.8, y: totalHeight - 0.4, z: 0.8 });
    }

    function addSofa(x, y, z, rotY = 0) {
      const sofa = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.0, 1.45), sofaMat);
      sofa.position.set(x, y + 0.5, z);
      sofa.rotation.y = rotY;
      sofa.castShadow = true;
      sofa.receiveShadow = true;
      mansionGroup.add(sofa);
      addBlockingMesh(sofa, { x: 3.2, y: 1.0, z: 1.45 });
    }

    // Living room (ground floor) with multiple couches
    const livingY = floorSurfaceY(0);
    addSofa(mansion.x - 8.7, livingY, mansion.z + 6.1, 0);
    addSofa(mansion.x - 8.7, livingY, mansion.z + 2.9, 0);
    addSofa(mansion.x - 11.2, livingY, mansion.z + 4.5, Math.PI * 0.5);

    const coffeeTable = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 1.1), tableMat);
    coffeeTable.position.set(mansion.x - 8.7, livingY + 0.275, mansion.z + 4.5);
    coffeeTable.castShadow = true;
    coffeeTable.receiveShadow = true;
    mansionGroup.add(coffeeTable);
    addBlockingMesh(coffeeTable, coffeeTable.geometry.parameters);

    // Dining room (ground floor) with table + chairs
    const diningTable = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.85, 2.1), tableMat);
    diningTable.position.set(mansion.x + 9.0, livingY + 0.425, mansion.z + 4.9);
    diningTable.castShadow = true;
    diningTable.receiveShadow = true;
    mansionGroup.add(diningTable);
    addBlockingMesh(diningTable, diningTable.geometry.parameters);

    const chairOffsets = [
      [-1.9, -1.35],
      [-0.6, -1.35],
      [0.6, -1.35],
      [1.9, -1.35],
      [-1.9, 1.35],
      [-0.6, 1.35],
      [0.6, 1.35],
      [1.9, 1.35],
    ];
    for (const [ox, oz] of chairOffsets) {
      const chair = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.82, 0.72), chairMat);
      chair.position.set(mansion.x + 9.0 + ox, livingY + 0.41, mansion.z + 4.9 + oz);
      chair.castShadow = true;
      chair.receiveShadow = true;
      mansionGroup.add(chair);
      addBlockingMesh(chair, chair.geometry.parameters);
    }

    // Bedroom (second floor) with bed + bedside table
    const bedFloorY = floorSurfaceY(1);
    const bedFrame = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.7, 5.1), bedMat);
    bedFrame.position.set(mansion.x - 8.8, bedFloorY + 0.35, mansion.z - 6.8);
    bedFrame.castShadow = true;
    bedFrame.receiveShadow = true;
    mansionGroup.add(bedFrame);
    addBlockingMesh(bedFrame, bedFrame.geometry.parameters);

    const pillow = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.34, 0.9), pillowMat);
    pillow.position.set(mansion.x - 8.8, bedFloorY + 0.77, mansion.z - 8.6);
    pillow.castShadow = true;
    pillow.receiveShadow = true;
    mansionGroup.add(pillow);

    const bedsideTable = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.78, 0.85), tableMat);
    bedsideTable.position.set(mansion.x - 6.6, bedFloorY + 0.39, mansion.z - 7.9);
    bedsideTable.castShadow = true;
    bedsideTable.receiveShadow = true;
    mansionGroup.add(bedsideTable);
    addBlockingMesh(bedsideTable, bedsideTable.geometry.parameters);
  }
  addColumnsAndFurniture();

  function addStairs() {
    const stairWidth = 2.8;
    const x1Min = mansion.x - halfW + 2.2;
    const x1Max = x1Min + stairWidth;
    const x2Min = x1Max + 0.95;
    const x2Max = x2Min + stairWidth;
    const zSouth = mansion.z + halfD - 3.6;
    const zNorth = mansion.z - halfD + 3.6;

    const stairMat = new THREE.MeshStandardMaterial({ color: 0x604635, roughness: 0.72, metalness: 0.04 });
    const railMat = new THREE.MeshStandardMaterial({ color: 0x2f2f33, roughness: 0.45, metalness: 0.5 });

    function buildFlight(xMin, xMax, zStart, zEnd, yStart, yEnd) {
      const dir = zEnd > zStart ? 1 : -1;
      const treads = 12;
      const stepDepth = Math.abs(zEnd - zStart) / treads;
      const stepRise = (yEnd - yStart) / treads;

      for (let i = 0; i < treads; i++) {
        const cz = zStart + dir * (i * stepDepth + stepDepth * 0.5);
        const cy = yStart + i * stepRise + stepRise * 0.5;
        const step = new THREE.Mesh(new THREE.BoxGeometry(xMax - xMin, stepRise + 0.02, stepDepth), stairMat);
        step.position.set((xMin + xMax) * 0.5, cy, cz);
        step.castShadow = true;
        step.receiveShadow = true;
        mansionGroup.add(step);
      }

      addRampWalkable(xMin, xMax, Math.min(zStart, zEnd), Math.max(zStart, zEnd), "z", zStart, zEnd, yStart, yEnd);

      const railH = 1.0;
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, railH, Math.abs(zEnd - zStart) + 0.25), railMat);
      rail.position.set(xMax + 0.04, (yStart + yEnd) * 0.5 + 0.45, (zStart + zEnd) * 0.5);
      rail.castShadow = true;
      rail.receiveShadow = true;
      mansionGroup.add(rail);
      addBlockingMesh(rail, rail.geometry.parameters);
    }

    for (let floor = 0; floor < mansion.floors - 1; floor++) {
      const y0 = floorSurfaceY(floor);
      const yMid = y0 + storyHeight * 0.5;
      const y1 = y0 + storyHeight;

      const landing = new THREE.Mesh(new THREE.BoxGeometry(stairWidth * 2 + 1, 0.24, 2.1), stairMat);
      landing.position.set((x1Min + x2Max) * 0.5, yMid - 0.12, zNorth);
      landing.castShadow = true;
      landing.receiveShadow = true;
      mansionGroup.add(landing);
      addFlatWalkable(x1Min, x2Max, zNorth - 1.05, zNorth + 1.05, yMid);

      buildFlight(x1Min, x1Max, zSouth, zNorth + 1.05, y0, yMid);
      buildFlight(x2Min, x2Max, zNorth - 1.05, zSouth, yMid, y1);
    }
  }
  addStairs();

  const interiorLights = [];
  for (let floor = 0; floor < mansion.floors; floor++) {
    const y = floorSurfaceY(floor) + 2.2;
    const p1 = new THREE.PointLight(0xffebcf, 0.65, 30, 2);
    p1.position.set(mansion.x - 7, y, mansion.z + 4);
    const p2 = new THREE.PointLight(0xffebcf, 0.6, 30, 2);
    p2.position.set(mansion.x + 7, y, mansion.z - 4);
    scene.add(p1, p2);
    interiorLights.push(p1, p2);
  }

  function spawnCivilians(count = 8) {
    function randomCivilianPosition() {
      for (let i = 0; i < 40; i++) {
        const x = (Math.random() - 0.5) * (worldSize - 18);
        const z = (Math.random() - 0.5) * (worldSize - 18);
        if (isNearHouseFootprint(x, z, 3.5)) continue;

        let unsafe = false;
        for (const zone of hazardZones) {
          if (Math.hypot(x - zone.x, z - zone.z) < zone.radius + 5) {
            unsafe = true;
            break;
          }
        }
        if (unsafe) continue;
        return { x, z };
      }
      return { x: 0, z: 0 };
    }

    for (let i = 0; i < count; i++) {
      const c = createCivilianModel();
      const p = randomCivilianPosition();
      c.root.position.set(p.x, terrainHeight(p.x, p.z) + 0.05, p.z);
      c.root.scale.setScalar(0.95 + Math.random() * 0.12);
      scene.add(c.root);
      civilians.push({
        mesh: c.root,
        parts: c.parts,
        dir: new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(),
        speed: 1.2 + Math.random() * 0.5,
        walkCycle: Math.random() * Math.PI * 2,
        timer: 1 + Math.random() * 3,
      });
    }
  }
  spawnCivilians(8);

  function updateCivilians(dt) {
    for (const c of civilians) {
      c.timer -= dt;
      if (c.timer <= 0) {
        c.timer = 1.8 + Math.random() * 3.8;
        c.dir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
      }

      const avoid = new THREE.Vector3();
      for (const zone of hazardZones) {
        const dx = c.mesh.position.x - zone.x;
        const dz = c.mesh.position.z - zone.z;
        const dist = Math.hypot(dx, dz);
        if (dist < zone.radius + 6) {
          const away = new THREE.Vector3(dx, 0, dz).normalize();
          avoid.addScaledVector(away, (zone.radius + 6 - dist) * 0.25);
        }
      }

      if (isNearHouseFootprint(c.mesh.position.x, c.mesh.position.z, 1.4)) {
        const awayHouse = new THREE.Vector3(c.mesh.position.x - mansion.x, 0, c.mesh.position.z - mansion.z).normalize();
        avoid.addScaledVector(awayHouse, 0.75);
      }

      const move = c.dir.clone().add(avoid).normalize();
      if (move.lengthSq() > 0.0001) {
        c.mesh.position.x = clamp(c.mesh.position.x + move.x * c.speed * dt, -worldRadius + 6, worldRadius - 6);
        c.mesh.position.z = clamp(c.mesh.position.z + move.z * c.speed * dt, -worldRadius + 6, worldRadius - 6);
        c.mesh.rotation.y = Math.atan2(move.x, move.z);
      }

      c.mesh.position.y = terrainHeight(c.mesh.position.x, c.mesh.position.z) + 0.05;

      c.walkCycle += dt * (1.8 + c.speed * 0.9);
      const swing = Math.sin(c.walkCycle) * 0.48;
      const kneeL = Math.max(0, Math.sin(c.walkCycle + Math.PI * 0.5)) * 0.34;
      const kneeR = Math.max(0, Math.sin(c.walkCycle + Math.PI * 1.5)) * 0.34;

      c.parts.shoulderL.rotation.x = swing;
      c.parts.shoulderR.rotation.x = -swing;
      c.parts.forearmL.rotation.x = -Math.max(0, swing) * 0.4;
      c.parts.forearmR.rotation.x = Math.max(0, swing) * 0.4;
      c.parts.hipL.rotation.x = -swing;
      c.parts.hipR.rotation.x = swing;
      c.parts.shinL.rotation.x = kneeL;
      c.parts.shinR.rotation.x = kneeR;
      c.parts.torso.position.y = 1.2 + Math.sin(c.walkCycle * 2) * 0.02;
    }
  }

  function updateDoors(dt) {
    const speed = 3.8;
    doorState.openAmount += (doorState.targetOpenAmount - doorState.openAmount) * Math.min(1, dt * speed);
    doorState.isOpen = doorState.openAmount > 0.55;

    const angle = doorState.maxOpenAngle * doorState.openAmount;
    leftDoorPivot.rotation.y = -angle;
    rightDoorPivot.rotation.y = angle;
  }

  function toggleNearestDoor(playerPos, range = 5.8) {
    const d = Math.hypot(playerPos.x - mansion.x, playerPos.z - (mansion.z + halfD));
    if (d > range) {
      return { changed: false, open: doorState.isOpen, message: "Move closer to the front door." };
    }
    doorState.targetOpenAmount = doorState.targetOpenAmount > 0.5 ? 0 : 1;
    return {
      changed: true,
      open: doorState.targetOpenAmount > 0.5,
      message: doorState.targetOpenAmount > 0.5 ? "Door opened." : "Door closed.",
    };
  }

  function getHeightAtDetailed(x, z, currentY = terrainHeight(x, z)) {
    let best = terrainHeight(x, z);
    let bestDelta = Math.abs(best - currentY);

    for (const s of walkableSurfaces) {
      if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;

      let y = s.y;
      if (s.type === "ramp") {
        const tRaw = (s.axis === "x" ? x - s.from : z - s.from) / Math.max(0.0001, s.to - s.from);
        const t = clamp(tRaw, 0, 1);
        y = s.yStart + (s.yEnd - s.yStart) * t;
      }

      const delta = Math.abs(y - currentY);
      if (delta < bestDelta + 0.001 || y > best) {
        best = y;
        bestDelta = delta;
      }
    }

    return best;
  }

  function resolveHorizontalCollision(position, radius = 0.45, bottomY = -Infinity, topY = Infinity) {
    const volumes = [...blockingVolumes];
    for (const dynamicVolume of dynamicBlockingVolumes) {
      if (dynamicVolume.isEnabled && !dynamicVolume.isEnabled()) continue;
      const box = dynamicVolume.getBox ? dynamicVolume.getBox() : null;
      if (box) volumes.push(box);
    }

    for (let pass = 0; pass < 4; pass++) {
      let adjusted = false;
      for (const box of volumes) {
        if (topY < box.minY || bottomY > box.maxY) continue;
        const push = horizontalPushFromAabb(position.x, position.z, radius, box);
        if (!push) continue;
        position.x += push.x;
        position.z += push.z;
        adjusted = true;
      }
      if (!adjusted) break;
    }

    position.x = clamp(position.x, -worldRadius + radius + 1, worldRadius - radius - 1);
    position.z = clamp(position.z, -worldRadius + radius + 1, worldRadius - radius - 1);
  }

  function getCameraTuningForPosition(playerPos) {
    if (!playerPos) return { distanceMultiplier: 1, shoulderMultiplier: 1, collisionPadding: 0.25 };
    const inside = isInsideMansionXZ(playerPos.x, playerPos.z, 1.2);
    if (!inside) return { distanceMultiplier: 1, shoulderMultiplier: 1, collisionPadding: 0.25 };
    return {
      distanceMultiplier: 0.52,
      shoulderMultiplier: 0.45,
      collisionPadding: 0.18,
    };
  }

  function constrainCameraPosition(cameraPos, pivot, playerPos) {
    if (!playerPos || !isInsideMansionXZ(playerPos.x, playerPos.z, 1.2)) return;
    const minX = mansion.x - halfW + 0.9;
    const maxX = mansion.x + halfW - 0.9;
    const minZ = mansion.z - halfD + 0.9;
    const maxZ = mansion.z + halfD - 0.9;
    const minY = groundSurfaceY + 0.65;
    const maxY = floorSurfaceY(mansion.floors - 1) + storyHeight + 0.8;

    cameraPos.x = clamp(cameraPos.x, minX, maxX);
    cameraPos.z = clamp(cameraPos.z, minZ, maxZ);
    cameraPos.y = clamp(cameraPos.y, minY, maxY);
  }

  const starCount = 1100;
  const starPositions = new Float32Array(starCount * 3);
  const starMinR = worldRadius + 80;
  const starMaxR = worldRadius + 210;
  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.52;
    const radius = starMinR + Math.random() * (starMaxR - starMinR);
    const sinPhi = Math.sin(phi);
    starPositions[i * 3] = Math.cos(theta) * sinPhi * radius;
    starPositions[i * 3 + 1] = Math.cos(phi) * radius + 22;
    starPositions[i * 3 + 2] = Math.sin(theta) * sinPhi * radius;
  }

  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xeaf3ff, size: 1.8, transparent: true, opacity: 0, depthWrite: false });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  const sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(3.4, 20, 20),
    new THREE.MeshBasicMaterial({ color: 0xffd46f })
  );
  const moonMesh = new THREE.Mesh(
    new THREE.SphereGeometry(2.5, 18, 18),
    new THREE.MeshBasicMaterial({ color: 0xbfd0f0 })
  );
  scene.add(sunMesh, moonMesh);

  const hazardGeo = new THREE.RingGeometry(6, 6.6, 32);
  hazardGeo.rotateX(-Math.PI / 2);
  const hazardMat = new THREE.MeshBasicMaterial({
    color: 0xff5533,
    transparent: true,
    opacity: 0.75,
    side: THREE.DoubleSide,
  });
  for (const zone of hazardZones) {
    const marker = new THREE.Mesh(hazardGeo, hazardMat.clone());
    marker.scale.setScalar(zone.radius / 6);
    marker.position.set(zone.x, terrainHeight(zone.x, zone.z) + 0.08, zone.z);
    scene.add(marker);
  }

  function getHazardDamageAt(x, z, dt) {
    let damage = 0;
    for (const zone of hazardZones) {
      const dx = x - zone.x;
      const dz = z - zone.z;
      const dist = Math.hypot(dx, dz);
      if (dist < zone.radius) {
        const edgeFactor = 1 - dist / zone.radius;
        damage += zone.dps * (0.45 + edgeFactor * 0.55) * dt;
      }
    }
    const y = terrainHeight(x, z);
    if (y < -1.6) damage += 6 * dt;
    return damage;
  }

  function getDayNightState(elapsedTime) {
    const cycle = (elapsedTime / DAY_NIGHT_FULL_CYCLE_SECONDS) * Math.PI * 2;
    const sunHeight = Math.sin(cycle);
    const daylight = Math.max(0, (sunHeight + 1) * 0.5);
    return { cycle, sunHeight, daylight, isNight: sunHeight < 0 };
  }

  function updateDayNight(elapsedTime, sun, hemi) {
    const { cycle, sunHeight, daylight } = getDayNightState(elapsedTime);
    const moonHeight = -sunHeight;
    const nightFactor = 1 - daylight;
    const orbitRadius = worldRadius + 54;
    const orbitYBase = 18;
    const orbitYScale = 78;

    const sunX = Math.cos(cycle) * orbitRadius;
    const sunY = orbitYBase + sunHeight * orbitYScale;
    const moonX = Math.cos(cycle + Math.PI) * orbitRadius;
    const moonY = orbitYBase + moonHeight * orbitYScale;

    sunMesh.position.set(sunX, sunY, 24);
    moonMesh.position.set(moonX, moonY, -32);
    sunMesh.visible = sunY > -6;
    moonMesh.visible = moonY > -6;

    sun.position.set(sunX, Math.max(5, sunY), 24);
    sun.intensity = 0.12 + daylight * 1.2;
    sun.color.copy(new THREE.Color(0xffc978).lerp(new THREE.Color(0xfff6d8), daylight));

    hemi.intensity = 0.16 + daylight * 0.55 + nightFactor * 0.06;
    hemi.color.copy(new THREE.Color(0x4a6794).lerp(new THREE.Color(0xc4e2ff), daylight));
    hemi.groundColor.copy(new THREE.Color(0x202631).lerp(new THREE.Color(0x466a3f), daylight));

    starMat.opacity = Math.pow(nightFactor, 1.9) * 0.92;

    const dayColor = new THREE.Color(0x87b8eb);
    const duskColor = new THREE.Color(0x3a4a77);
    const nightColor = new THREE.Color(0x070b17);
    const twilight = 1 - Math.min(1, Math.abs(daylight - 0.5) * 2);
    const skyColor = nightColor
      .clone()
      .lerp(duskColor, Math.max(daylight, twilight * 0.9))
      .lerp(dayColor, Math.pow(daylight, 1.25));
    scene.background = skyColor;
    scene.fog.color.copy(scene.background);
  }

  return {
    worldSize,
    cameraCollisionMeshes,
    blockingMeshes,
    getHeightAt: terrainHeight,
    getHeightAtDetailed,
    resolveHorizontalCollision,
    getHazardDamageAt,
    getDayNightState,
    updateDayNight,
    updateDoors,
    toggleNearestDoor,
    getCameraTuningForPosition,
    constrainCameraPosition,
    updateCivilians,
  };
}
