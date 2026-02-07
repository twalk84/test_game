import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";
import { CONFIG } from "./config.js";

function terrainHeight(x, z) {
  return (
    Math.sin(x * 0.05) * 1.8 +
    Math.cos(z * 0.04) * 1.5 +
    Math.sin((x + z) * 0.02) * 1.2
  );
}

export function createWorld(scene) {
  const worldSize = CONFIG.world.size;
  const segments = CONFIG.world.segments;
  const cameraCollisionMeshes = [];
  const worldRadius = worldSize * 0.5;
  const hazardZones = CONFIG.world.hazardZones;

  scene.fog = new THREE.Fog(CONFIG.world.fog.color, CONFIG.world.fog.near, CONFIG.world.fog.far);

  // --- Terrain with vertex colors ---
  const groundGeo = new THREE.PlaneGeometry(worldSize, worldSize, segments, segments);
  groundGeo.rotateX(-Math.PI / 2);

  const pos = groundGeo.attributes.position;
  const vertexColors = new Float32Array(pos.count * 3);

  const colorLow = new THREE.Color(0x5a4a32);   // brown (mud/low)
  const colorMid = new THREE.Color(0x3d7f45);   // green (grass)
  const colorHigh = new THREE.Color(0x7a7a72);  // grey (rocky)

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = terrainHeight(x, z);
    pos.setY(i, y);

    // Height-based color blend
    const color = new THREE.Color();
    if (y < -0.5) {
      color.lerpColors(colorLow, colorMid, Math.max(0, (y + 2.5) / 2.0));
    } else if (y < 2.0) {
      color.lerpColors(colorMid, colorMid, 1);
      // Slight variation
      color.offsetHSL(0, 0, (Math.random() - 0.5) * 0.03);
    } else {
      const t = Math.min(1, (y - 2.0) / 2.0);
      color.lerpColors(colorMid, colorHigh, t);
    }

    const i3 = i * 3;
    vertexColors[i3] = color.r;
    vertexColors[i3 + 1] = color.g;
    vertexColors[i3 + 2] = color.b;
  }

  groundGeo.setAttribute("color", new THREE.BufferAttribute(vertexColors, 3));
  groundGeo.computeVertexNormals();

  const groundMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0.03,
  });

  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  scene.add(ground);
  cameraCollisionMeshes.push(ground);

  // --- Water plane ---
  const waterGeo = new THREE.PlaneGeometry(worldSize, worldSize, 40, 40);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x1a5276,
    transparent: true,
    opacity: 0.48,
    roughness: 0.2,
    metalness: 0.3,
    side: THREE.DoubleSide,
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.position.y = -1.0;
  water.receiveShadow = true;
  scene.add(water);
  const waterPositions = waterGeo.attributes.position;

  // --- Decorative props (rocks/trees with variety) ---
  const rockGeo = new THREE.DodecahedronGeometry(0.9, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 1 });

  const treeTrunkGeo = new THREE.CylinderGeometry(0.2, 0.24, 2.6, 10);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5d3a1a, roughness: 1 });
  const leafGeoLarge = new THREE.ConeGeometry(1.2, 2.3, 10);
  const leafGeoMid = new THREE.ConeGeometry(0.95, 2.0, 10);
  const leafGeoTop = new THREE.ConeGeometry(0.7, 1.7, 10);
  const leafGeoTip = new THREE.ConeGeometry(0.42, 1.15, 10);

  // Store foliage meshes for wind sway animation
  const foliageMeshes = [];

  function createLayeredPineTree(x, z, y) {
    // Per-tree color variation
    const hueShift = (Math.random() - 0.5) * 0.06;
    const leafMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(0.35 + hueShift, 0.55, 0.28),
      roughness: 0.9,
    });

    const trunk = new THREE.Mesh(treeTrunkGeo, trunkMat);
    trunk.position.set(x, y + 1.3, z);
    trunk.castShadow = true;
    trunk.receiveShadow = true;

    const sway = (Math.random() - 0.5) * 0.07;
    trunk.rotation.z = sway;

    const leafBottom = new THREE.Mesh(leafGeoLarge, leafMat);
    leafBottom.position.set(x, y + 2.35, z);
    leafBottom.castShadow = true;

    const leafMid = new THREE.Mesh(leafGeoMid, leafMat);
    leafMid.position.set(x, y + 3.25, z);
    leafMid.castShadow = true;

    const leafTop = new THREE.Mesh(leafGeoTop, leafMat);
    leafTop.position.set(x, y + 4.05, z);
    leafTop.castShadow = true;

    const leafTip = new THREE.Mesh(leafGeoTip, leafMat);
    leafTip.position.set(x, y + 4.72, z);
    leafTip.castShadow = true;

    const scale = 0.82 + Math.random() * 0.62;
    trunk.scale.setScalar(scale);
    leafBottom.scale.setScalar(scale);
    leafMid.scale.setScalar(scale);
    leafTop.scale.setScalar(scale);
    leafTip.scale.setScalar(scale);

    scene.add(trunk, leafBottom, leafMid, leafTop, leafTip);
    cameraCollisionMeshes.push(trunk, leafBottom, leafMid, leafTop, leafTip);

    // Track foliage for wind sway (use tip and top as they move most)
    const windPhase = Math.random() * Math.PI * 2;
    foliageMeshes.push(
      { mesh: leafTip, baseZ: sway, phase: windPhase, amplitude: 0.035 },
      { mesh: leafTop, baseZ: sway, phase: windPhase, amplitude: 0.025 },
      { mesh: leafMid, baseZ: sway, phase: windPhase, amplitude: 0.015 }
    );
  }

  for (let i = 0; i < 210; i++) {
    const x = (Math.random() - 0.5) * (worldSize - 20);
    const z = (Math.random() - 0.5) * (worldSize - 20);
    const y = terrainHeight(x, z);

    if (Math.random() < 0.22) {
      const rock = new THREE.Mesh(rockGeo, rockMat);
      rock.position.set(x, y + 0.8, z);
      rock.scale.setScalar(0.7 + Math.random() * 1.2);
      rock.castShadow = true;
      rock.receiveShadow = true;
      scene.add(rock);
      cameraCollisionMeshes.push(rock);
    } else {
      createLayeredPineTree(x, z, y);
    }
  }

  // --- Stars ---
  const starCount = 1100;
  const starPositions = new Float32Array(starCount * 3);
  const starMinR = worldRadius + 80;
  const starMaxR = worldRadius + 210;

  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.52;
    const radius = starMinR + Math.random() * (starMaxR - starMinR);
    const sinPhi = Math.sin(phi);
    const sx = Math.cos(theta) * sinPhi * radius;
    const sy = Math.cos(phi) * radius + 22;
    const sz = Math.sin(theta) * sinPhi * radius;

    starPositions[i * 3] = sx;
    starPositions[i * 3 + 1] = sy;
    starPositions[i * 3 + 2] = sz;
  }

  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0xeaf3ff,
    size: 1.8,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // --- Sun/Moon meshes ---
  const sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(3.4, 20, 20),
    new THREE.MeshBasicMaterial({ color: 0xffd46f })
  );
  const moonMesh = new THREE.Mesh(
    new THREE.SphereGeometry(2.5, 18, 18),
    new THREE.MeshBasicMaterial({ color: 0xbfd0f0 })
  );
  scene.add(sunMesh, moonMesh);

  // --- Hazard zone markers ---
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
    if (y < CONFIG.world.lowTerrainThreshold) {
      damage += CONFIG.world.lowTerrainDps * dt;
    }
    return damage;
  }

  function updateDayNight(elapsedTime, sun, hemi) {
    const cycle = elapsedTime * CONFIG.world.dayNightSpeed;
    const sunHeight = Math.sin(cycle);
    const moonHeight = -sunHeight;
    const daylight = Math.max(0, (sunHeight + 1) * 0.5);
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

    // Water color shifts with time of day
    waterMat.color.copy(new THREE.Color(0x0a2a3e).lerp(new THREE.Color(0x1a5276), daylight));
    waterMat.opacity = 0.35 + daylight * 0.15;

    // Gentle water wave animation
    for (let i = 0; i < waterPositions.count; i++) {
      const wx = waterPositions.getX(i);
      const wz = waterPositions.getZ(i);
      waterPositions.setY(i, Math.sin(elapsedTime * 0.8 + wx * 0.04 + wz * 0.03) * 0.12);
    }
    waterPositions.needsUpdate = true;

    // Wind sway on tree foliage
    const windStrength = Math.sin(elapsedTime * 0.3) * 0.5 + 0.5;
    for (const f of foliageMeshes) {
      f.mesh.rotation.z = f.baseZ + Math.sin(elapsedTime * 1.2 + f.phase) * f.amplitude * (0.5 + windStrength);
    }
  }

  return {
    worldSize,
    cameraCollisionMeshes,
    getHeightAt: terrainHeight,
    getHazardDamageAt,
    updateDayNight,
  };
}
