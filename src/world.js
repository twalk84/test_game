import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";

function terrainHeight(x, z) {
  return (
    Math.sin(x * 0.05) * 1.8 +
    Math.cos(z * 0.04) * 1.5 +
    Math.sin((x + z) * 0.02) * 1.2
  );
}

export function createWorld(scene) {
  const worldSize = 220;
  const segments = 110;
  const cameraCollisionMeshes = [];
  const hazardZones = [
    { x: -38, z: 34, radius: 10, dps: 7 },
    { x: 45, z: -22, radius: 12, dps: 8 },
    { x: 6, z: 48, radius: 8, dps: 9 },
  ];

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

  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x3d7f45,
    roughness: 0.95,
    metalness: 0.03,
  });

  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  scene.add(ground);
  cameraCollisionMeshes.push(ground);

  // Decorative props (rocks/trees)
  const rockGeo = new THREE.DodecahedronGeometry(0.9, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 1 });

  const treeTrunkGeo = new THREE.CylinderGeometry(0.18, 0.22, 1.4, 8);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5d3a1a, roughness: 1 });
  const leafGeo = new THREE.ConeGeometry(0.9, 1.8, 10);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2d6e2f, roughness: 0.9 });

  for (let i = 0; i < 120; i++) {
    const x = (Math.random() - 0.5) * (worldSize - 20);
    const z = (Math.random() - 0.5) * (worldSize - 20);
    const y = terrainHeight(x, z);

    if (Math.random() < 0.35) {
      const rock = new THREE.Mesh(rockGeo, rockMat);
      rock.position.set(x, y + 0.8, z);
      rock.scale.setScalar(0.7 + Math.random() * 1.2);
      rock.castShadow = true;
      rock.receiveShadow = true;
      scene.add(rock);
      cameraCollisionMeshes.push(rock);
    } else {
      const trunk = new THREE.Mesh(treeTrunkGeo, trunkMat);
      trunk.position.set(x, y + 0.7, z);
      trunk.castShadow = true;
      trunk.receiveShadow = true;

      const leaves = new THREE.Mesh(leafGeo, leafMat);
      leaves.position.set(x, y + 2.1, z);
      leaves.castShadow = true;

      scene.add(trunk, leaves);
      cameraCollisionMeshes.push(trunk, leaves);
    }
  }

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
    if (y < -1.6) {
      damage += 6 * dt;
    }
    return damage;
  }

  function updateDayNight(elapsedTime, sun, hemi) {
    const cycle = elapsedTime * 0.08;
    const sunHeight = Math.sin(cycle);
    const daylight = Math.max(0.12, (sunHeight + 1) * 0.5);

    sun.position.set(Math.cos(cycle) * 52, 18 + (sunHeight + 1) * 20, 24);
    sun.intensity = 0.2 + daylight * 1.15;
    hemi.intensity = 0.2 + daylight * 0.7;

    const dayColor = new THREE.Color(0x87b8eb);
    const duskColor = new THREE.Color(0x1a2742);
    scene.background = duskColor.clone().lerp(dayColor, daylight);
    scene.fog.color.copy(scene.background);
  }

  return {
    worldSize,
    cameraCollisionMeshes,
    getHeightAt: terrainHeight,
    getHazardDamageAt,
    updateDayNight,
  };
}
