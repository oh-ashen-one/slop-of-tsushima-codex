import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from '../../core/Context.js';

const UP = new THREE.Vector3(0, 1, 0);

export const SHRINE_APPROACH = Object.freeze({
  startZ: -58,
  endZ: 31.5,
  routeHalfWidth: 4.6,
  scatterHalfWidth: 9.4,
  lanternX: 6.25,
  guardianInnerEdge: 7.2,
});

/** Closed sanctuary threshold: visual door plane plus its solid-world proxy. */
export const SHRINE_TERMINAL = Object.freeze({
  endpointZ: SHRINE_APPROACH.endZ,
  facadeZ: 32.72,
  halfWidth: 5.6,
  halfDepth: 0.18,
  returnX: 5.55,
  returnZ: 36.55,
  returnHalfWidth: 0.78,
  returnHalfDepth: 4.0,
  minY: 1.08,
  maxY: 6.45,
});

const APPROACH_FIRST_Z = SHRINE_APPROACH.startZ;
const APPROACH_END_Z = 27;
const APPROACH_PITCH = 1.48;
const APPROACH_ROWS = Math.ceil((APPROACH_END_Z - APPROACH_FIRST_Z) / APPROACH_PITCH);
const APPROACH_LAST_Z = APPROACH_FIRST_Z + (APPROACH_ROWS - 1) * APPROACH_PITCH;
const APPROACH_TOP = 0.065;
const FORECOURT_TOP = 0.495;
const STAIR_COUNT = 5;

/**
 * Exact query surface for the rendered shrine walk. The old shrine lifted its
 * slabs, steps and sanctuary deck visually but left the character on terrain;
 * by the last stair the ronin was buried to the shoulders and the follow lens
 * was looking through slab fronts. Keep this analytic and cheap: getHeight is
 * a hot query, so it must not scan the hundred-plus individual forecourt slabs.
 */
export function makeShrineWalkSurface({ cx = 0, cz = 0, yaw = 0, baseY = 0 } = {}) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const toLocal = (x, z) => {
    const dx = x - cx, dz = z - cz;
    return { x: dx * c - dz * s, z: dx * s + dz * c };
  };
  const surfaceAtLocal = (x, z) => {
    let top = -Infinity;

    // Continuous, overlapping centre slabs. Quantise to the rendered row so
    // the small ceremonial rise is identical to the geometry underfoot.
    if (Math.abs(x) <= 1.45 && z >= APPROACH_FIRST_Z - 0.75 && z <= APPROACH_LAST_Z + 0.75) {
      const row = Math.max(0, Math.min(APPROACH_ROWS - 1,
        Math.round((z - APPROACH_FIRST_Z) / APPROACH_PITCH)));
      const rz = APPROACH_FIRST_Z + row * APPROACH_PITCH;
      top = Math.max(top, Math.max(0, (rz + 8) * 0.018) + APPROACH_TOP);
    }

    // Broad courtyard slabs are level; their authored rows overlap slightly.
    if (Math.abs(x) <= 8.35 && z >= 10.25 && z <= 29.57) {
      top = Math.max(top, FORECOURT_TOP);
    }

    // Five visible box steps. Max wins in their overlaps, exactly like depth.
    for (let i = 0; i < STAIR_COUNT; i++) {
      const stepZ = 27.6 + i * 0.72;
      const halfX = (15.8 - i * 0.35) * 0.5;
      if (Math.abs(x) <= halfX && Math.abs(z - stepZ) <= 0.56) {
        top = Math.max(top, 0.33 + i * 0.16);
      }
    }

    // Sanctuary stone platform and the timber deck immediately behind it.
    if (Math.abs(x) <= 6.75 && z >= 30.75 && z <= 41.25) top = Math.max(top, 0.905);
    if (Math.abs(x) <= 6.05 && z >= 31.30 && z <= 40.70) top = Math.max(top, 1.145);
    return Number.isFinite(top) ? baseY + top : null;
  };
  const heightAt = (x, z) => {
    // This is Terrain's hot query. Keep the public transform helper above for
    // diagnostics, but do the two scalar dot products here without allocating
    // a temporary {x,z} on every height/normal/camera probe.
    const dx = x - cx, dz = z - cz;
    return surfaceAtLocal(dx * c - dz * s, dx * s + dz * c);
  };
  return {
    cx, cz, yaw, baseY, bound: 61,
    toLocal, surfaceAtLocal, heightAt,
    contains: (x, z) => heightAt(x, z) != null,
    sample(x, z) {
      const y = heightAt(x, z);
      return y == null ? { y: 0, w: 0 } : { y, w: 1 };
    },
  };
}

/**
 * World-space endpoint contract for the closed sanctuary facade.
 *
 * The endpoint is deliberately before the door's capsule-clearance line, so
 * reaching it reads as arrival rather than an invitation to push through the
 * architecture. The collider is also queryable: the same fact that stops the
 * character is visible to the follow-camera sphere cast.
 */
export function makeShrineTerminal({ cx = 0, cz = 0, yaw = 0, baseY = 0 } = {}) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const atLocal = (x, z, y) => new THREE.Vector3(
    cx + c * x + s * z,
    baseY + y,
    cz - s * x + c * z,
  );
  const midY = (SHRINE_TERMINAL.minY + SHRINE_TERMINAL.maxY) * 0.5;
  const halfY = (SHRINE_TERMINAL.maxY - SHRINE_TERMINAL.minY) * 0.5;
  const facade = {
    shape: 'box',
    position: atLocal(0, SHRINE_TERMINAL.facadeZ, midY),
    halfExtents: new THREE.Vector3(
      SHRINE_TERMINAL.halfWidth,
      halfY,
      SHRINE_TERMINAL.halfDepth,
    ),
    axis: [c, -s],
    tag: 'shrine_facade',
  };
  const returns = [-1, 1].map((side) => ({
    shape: 'box',
    position: atLocal(side * SHRINE_TERMINAL.returnX, SHRINE_TERMINAL.returnZ, midY),
    halfExtents: new THREE.Vector3(
      SHRINE_TERMINAL.returnHalfWidth,
      halfY,
      SHRINE_TERMINAL.returnHalfDepth,
    ),
    axis: [c, -s],
    tag: side < 0 ? 'shrine_return_left' : 'shrine_return_right',
  }));
  return {
    endpoint: atLocal(0, SHRINE_TERMINAL.endpointZ, 1.145),
    focus: atLocal(0, SHRINE_TERMINAL.facadeZ, 3.45),
    clearanceZ: SHRINE_TERMINAL.facadeZ - SHRINE_TERMINAL.halfDepth,
    collider: facade,
    colliders: [facade, ...returns],
  };
}

/** Follow the visible terrain contour; the legacy western pad is not rendered here. */
export function resolveShrineAxis(terrain) {
  const siteDir = terrain && terrain.townSite && terrain.townSite.dir;
  if (siteDir) return new THREE.Vector2(siteDir.x, siteDir.z).normalize();
  const bearing = terrain && terrain.townPad && terrain.townPad.bearing;
  if (bearing && Number.isFinite(bearing[0]) && Number.isFinite(bearing[1])) {
    return new THREE.Vector2(bearing[0], bearing[1]).normalize();
  }
  return new THREE.Vector2(0, 1);
}

/** Deterministic side dressing whose full footprint stays outside the avenue. */
export function planGuardianStones(rand, count = 24) {
  const stones = [];
  for (let i = 0; i < count; i++) {
    const r = 0.35 + rand() * 1.05;
    const side = i % 2 ? -1 : 1;
    const innerEdge = SHRINE_APPROACH.guardianInnerEdge + rand() * 6.2;
    stones.push({
      x: side * (innerEdge + r * 1.35),
      y: r * 0.42,
      z: -4 + rand() * 44,
      r,
      rotation: [rand(), rand() * Math.PI, rand()],
    });
  }
  return stones;
}

/**
 * A compact shrine precinct built from a deliberately small primitive kit.
 * The old settlement was technically rich but unmistakably western; this
 * landmark supplies the visual language the episode actually promises:
 * vermilion torii, a lantern procession, stone approach, tiled eaves and a
 * dark timber sanctuary at the end of the climb.
 */
export function buildJapaneseShrine(ctx, terrain) {
  const rand = rng((ctx.seed ^ 0x4a504e31) >>> 0);
  const group = new THREE.Group();
  group.name = 'shrine_precinct';

  const site = terrain && terrain.townSite;
  const cx = site ? site.x : -520;
  const cz = site ? site.z : -180;
  const dir = resolveShrineAxis(terrain);
  const yaw = Math.atan2(dir.x, dir.y);
  const baseY = ctx.world.getHeight(cx, cz) + 0.04;
  group.position.set(cx, baseY, cz);
  group.rotation.y = yaw;

  const mats = new Map();
  const mat = (name, color, roughness = 0.82, extra = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });
    m.name = `shrine_${name}`;
    mats.set(name, m);
    const sky = ctx.get('sky');
    const light = ctx.get('lighting');
    if (sky && sky.injectAerialPerspective) sky.injectAerialPerspective(m);
    if (light && light.registerMaterial) light.registerMaterial(m);
    return m;
  };
  const vermilion = mat('vermilion', 0x9f2518, 0.74);
  const redDark = mat('red_dark', 0x45130f, 0.88);
  const timber = mat('timber', 0x241811, 0.93);
  const plaster = mat('plaster', 0xd8d0ba, 0.96);
  const roof = mat('roof', 0x151a18, 0.72);
  const stone = mat('stone', 0x6d7068, 0.97);
  const stoneDark = mat('stone_dark', 0x3e4642, 1.0);
  const rope = mat('rope', 0xb49a60, 1.0);
  const glow = mat('glow', 0xffd08a, 0.38, {
    emissive: new THREE.Color(0xff7a21), emissiveIntensity: 1.8,
  });
  const plasterAge = mat('plaster_age', 0xa99f87, 0.99);
  const moss = mat('moss_stone', 0x4f5a45, 1.0);

  const geometries = [];
  const meshes = [];
  const add = (geo, material, pos, scale = null, parent = group) => {
    if (!geometries.includes(geo)) geometries.push(geo);
    const m = new THREE.Mesh(geo, material);
    m.position.set(pos[0], pos[1], pos[2]);
    if (scale) m.scale.set(scale[0], scale[1], scale[2]);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    meshes.push(m);
    return m;
  };

  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl12 = new THREE.CylinderGeometry(0.5, 0.58, 1, 12);
  const cyl8 = new THREE.CylinderGeometry(0.5, 0.58, 1, 8);
  const ring = new THREE.TorusGeometry(0.5, 0.07, 6, 18);
  geometries.push(box, cyl12, cyl8, ring);

  const torii = (z, s = 1) => {
    const g = new THREE.Group();
    g.position.set(0, 0, z);
    group.add(g);
    add(cyl12, vermilion, [-2.45 * s, 2.45 * s, 0], [0.54 * s, 4.9 * s, 0.54 * s], g);
    add(cyl12, vermilion, [2.45 * s, 2.45 * s, 0], [0.54 * s, 4.9 * s, 0.54 * s], g);
    add(box, vermilion, [0, 4.15 * s, 0], [6.7 * s, 0.38 * s, 0.48 * s], g);
    const cap = add(box, redDark, [0, 4.72 * s, 0], [8.0 * s, 0.34 * s, 0.72 * s], g);
    cap.rotation.z = -0.018;
    add(box, vermilion, [0, 3.58 * s, 0], [5.8 * s, 0.28 * s, 0.40 * s], g);
    add(box, redDark, [0, 3.0 * s, 0], [1.85 * s, 0.95 * s, 0.34 * s], g);
  };

  torii(-39, 1.18);
  torii(-15, 0.92);
  torii(8, 0.72);

  // Irregular stone approach: shared geometry, authored rhythm, no texture tiling.
  const pathGeo = new THREE.BoxGeometry(4.15, 0.13, 1.50);
  geometries.push(pathGeo);
  for (let i = 0; i < APPROACH_ROWS; i++) {
    const z = APPROACH_FIRST_Z + i * APPROACH_PITCH;
    const x = (rand() - 0.5) * 0.28;
    const y = Math.max(0, (z + 8) * 0.018);
    const p = add(pathGeo, i % 3 === 0 ? stoneDark : stone, [x, y, z]);
    p.rotation.y = (rand() - 0.5) * 0.12;
    p.scale.x = 0.82 + rand() * 0.32;
  }

  const lantern = (x, z, k = 1) => {
    add(cyl8, stoneDark, [x, 0.20 * k, z], [0.75 * k, 0.40 * k, 0.75 * k]);
    add(cyl8, stone, [x, 1.15 * k, z], [0.42 * k, 1.55 * k, 0.42 * k]);
    add(box, stone, [x, 2.05 * k, z], [1.1 * k, 0.22 * k, 1.1 * k]);
    add(box, glow, [x, 2.42 * k, z], [0.62 * k, 0.66 * k, 0.62 * k]);
    const hood = add(cyl8, stoneDark, [x, 2.83 * k, z], [1.02 * k, 0.26 * k, 1.02 * k]);
    hood.rotation.y = Math.PI / 8;
  };
  for (let i = 0; i < 10; i++) {
    const z = -30 + i * 5.6;
    lantern(-SHRINE_APPROACH.lanternX - (i % 2) * 0.18, z, 0.78 + (i % 3) * 0.04);
    lantern(SHRINE_APPROACH.lanternX + (i % 2) * 0.18, z, 0.78 + ((i + 1) % 3) * 0.04);
  }

  /* Enclosed precinct shell. The walls begin beyond the outer gate so the
     field approach stays open, then converge the eye into the sanctuary. */
  for (const side of [-1, 1]) {
    for (let z = -5, i = 0; z <= 45; z += 4.0, i++) {
      const lean = (rand() - 0.5) * 0.018;
      const wall = add(box, i % 4 === 0 ? plasterAge : plaster,
        [side * 10.2, 1.65, z], [0.48, 2.65, 4.15]);
      wall.rotation.z = lean * side;
      add(box, timber, [side * 9.91, 1.68, z], [0.20, 2.82, 0.20]);
      const cap = add(box, roof, [side * 10.2, 3.18, z], [0.98, 0.24, 4.38]);
      cap.rotation.z = side * -0.16;
      if (i % 3 === 0) add(box, moss, [side * 9.93, 0.22, z], [0.16, 0.32, 3.2]);
    }
  }
  for (let x = -8, i = 0; x <= 8; x += 4.0, i++) {
    add(box, i % 3 === 0 ? plasterAge : plaster, [x, 1.65, 47.4], [4.15, 2.65, 0.48]);
    add(box, roof, [x, 3.18, 47.4], [4.4, 0.24, 0.98]);
  }

  // Broad forecourt, individually broken into irregular weathered slabs.
  for (let z = 11, row = 0; z <= 29; z += 1.62, row++) {
    for (let x = -7.6, col = 0; x <= 7.6; x += 1.72, col++) {
      const slab = add(box, (row + col) % 5 === 0 ? moss : ((row + col) % 3 === 0 ? stoneDark : stone),
        [x + (rand() - 0.5) * 0.14, 0.43, z],
        [1.60, 0.13, 1.48]);
      slab.rotation.y = (rand() - 0.5) * 0.055;
    }
  }
  // A low, wide stair flight makes the sanctuary feel elevated and ceremonial.
  for (let i = 0; i < 5; i++) {
    add(box, i % 2 ? stoneDark : stone, [0, 0.18 + i * 0.16, 27.6 + i * 0.72],
      [15.8 - i * 0.35, 0.30, 1.12]);
  }

  // Sanctuary: white infill inside dark post-and-beam, raised above the field.
  add(box, stoneDark, [0, 0.48, 36], [13.5, 0.85, 10.5]);
  add(box, timber, [0, 1.02, 36], [12.1, 0.25, 9.4]);
  add(box, plaster, [0, 3.72, 36.7], [10.6, 5.2, 7.0]);
  for (const x of [-5.15, -2.6, 0, 2.6, 5.15]) {
    add(box, timber, [x, 3.75, 32.9], [0.32, 5.65, 0.34]);
  }
  for (const z of [33.0, 40.15]) {
    for (const x of [-5.2, 5.2]) add(box, timber, [x, 3.75, z], [0.34, 5.7, 0.34]);
  }
  add(box, timber, [0, 5.75, 32.75], [11.2, 0.34, 0.34]);
  add(box, redDark, [0, 3.45, 32.72], [3.3, 4.1, 0.24]);
  for (const x of [-1.18, -0.4, 0.4, 1.18]) add(box, timber, [x, 3.42, 32.55], [0.13, 3.7, 0.16]);

  const leftRoof = add(box, roof, [-2.44, 6.65, 36.0], [6.0, 0.35, 10.3]);
  const rightRoof = add(box, roof, [2.44, 6.65, 36.0], [6.0, 0.35, 10.3]);
  leftRoof.rotation.z = -0.44;
  rightRoof.rotation.z = 0.44;
  add(box, roof, [0, 7.78, 36], [0.30, 0.46, 10.7]);
  // Long projecting eave line, a strong Japanese silhouette at distance.
  add(box, roof, [0, 5.98, 31.25], [14.0, 0.28, 0.68]);
  add(box, roof, [0, 5.98, 40.75], [14.0, 0.28, 0.68]);

  // Shimenawa and bell at the inner gate.
  const shime = add(ring, rope, [0, 3.12, 8.05], [3.8, 1.0, 1.0]);
  shime.rotation.y = Math.PI * 0.5;
  add(cyl8, rope, [0, 2.62, 8.05], [0.24, 0.62, 0.24]);

  // Sparse boulders/guardian stones give the precinct a natural edge.
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  geometries.push(rockGeo);
  for (const stoneSpec of planGuardianStones(rand)) {
    const { x, y, z, r, rotation } = stoneSpec;
    const m = add(rockGeo, rand() < 0.4 ? stoneDark : stone,
      [x, y, z], [r * 1.35, r * 0.75, r]);
    m.rotation.set(rotation[0], rotation[1], rotation[2]);
  }

  /* Merge the dense static precinct by material. Hundreds of individually
     authored stones/posts become a dozen draw calls without losing silhouette. */
  group.updateMatrixWorld(true);
  const buckets = new Map();
  group.traverse((o) => {
    if (!o.isMesh) return;
    // Primitive generators disagree about indexed vs non-indexed output;
    // normalise before batching so stone slabs and dodecahedral guardian rocks
    // can live in the same material draw.
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    if (!buckets.has(o.material)) buckets.set(o.material, []);
    buckets.get(o.material).push(g);
  });
  group.clear();
  group.position.set(0, 0, 0);
  group.rotation.set(0, 0, 0);
  for (const g of geometries) g.dispose();
  geometries.length = 0;
  meshes.length = 0;
  for (const [material, parts] of buckets) {
    const merged = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    geometries.push(merged);
    const m = new THREE.Mesh(merged, material);
    m.name = `shrine_merged_${material.name}`;
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    meshes.push(m);
  }

  ctx.scene.add(group);
  const lighting = ctx.get('lighting');
  if (lighting && lighting.requestShadowCaster) {
    group.traverse((o) => { if (o.isMesh && o.castShadow) lighting.requestShadowCaster(o); });
  }

  const V = (x, y, z) => new THREE.Vector3(x, y, z).applyAxisAngle(UP, yaw)
    .add(new THREE.Vector3(cx, baseY, cz));
  const walkSurface = makeShrineWalkSurface({ cx, cz, yaw, baseY });
  const terminal = makeShrineTerminal({ cx, cz, yaw, baseY });
  let heightOverride = null;
  if (terrain && terrain.addHeightOverride) {
    heightOverride = terrain.addHeightOverride({
      cx, cz, bound: walkSurface.bound, cell: 0.2,
      sample: (x, z) => walkSurface.sample(x, z),
      contains: (x, z) => walkSurface.contains(x, z),
      heightAt: (x, z) => walkSurface.heightAt(x, z),
    });
  }
  const physics = ctx.get('physics');
  const colliders = [];
  if (physics && physics.addCollider) {
    for (const spec of terminal.colliders) {
      colliders.push(physics.addCollider({
        ...spec,
        mask: physics.LAYER.WORLD,
        owner: group,
      }));
    }
  }
  const camera = V(0, 2.0, SHRINE_APPROACH.startZ);
  const destination = V(0, 5.0, SHRINE_APPROACH.endZ);
  const center = V(0, 1.0, 6);
  const lights = [];
  if (lighting && lighting.addLight) {
    for (let i = 0; i < 8; i++) {
      const z = -24.4 + i * 7.0;
      const x = i % 2 ? -4.15 : 4.15;
      const p = V(x, 2.42, z);
      // LocalLights captures the authored intensity before parking the light;
      // a non-zero base is therefore required for a real pool at night.
      const lamp = new THREE.PointLight(0xff8b36, 0.78, 15, 2);
      lamp.position.copy(p);
      lamp.name = `shrine_lantern_${i}`;
      ctx.scene.add(lamp);
      lighting.addLight(lamp, { raw: true, flicker: 0.07, radius: 15, importance: 2.4, shadow: false });
      lights.push(lamp);
    }
  }
  ctx.poi.set('town', { pos: camera, look: destination });
  ctx.poi.set('town_end', { pos: destination, look: camera });
  ctx.poi.set('town_center', { pos: center, look: destination });
  // The old night-camp capture now becomes a quiet lantern-lit shrine view.
  ctx.poi.set('camp', { pos: V(-6.2, 1.45, -19), look: V(0, 2.7, 8) });
  ctx.poi.set('camp_fire', { pos: V(-4.15, 2.42, -7.6), look: V(0, 3, 8) });

  return {
    group, mats, meshes, geometries, lights, walkSurface, heightOverride, terrain,
    terminal, colliders, physics,
    site: {
      x: cx, z: cz, radius: 92,
      routeStart: camera.clone(),
      routeEnd: destination.clone(),
      terminal: {
        position: terminal.endpoint.clone(),
        focus: terminal.focus.clone(),
        clearanceZ: terminal.clearanceZ,
      },
      routeHalfWidth: SHRINE_APPROACH.routeHalfWidth,
      onStreet: (x, z, padding = 0) => {
        const dx = x - cx, dz = z - cz;
        const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
        const lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
        return Math.abs(lx) < SHRINE_APPROACH.scatterHalfWidth + padding
          && lz > SHRINE_APPROACH.startZ - padding && lz < 48 + padding;
      },
      contains: (x, z) => (x - cx) ** 2 + (z - cz) ** 2 < 92 ** 2,
    },
  };
}

const BRIDGE_WIDTH = 2.9;
const BRIDGE_APPROACH = 3;
const BRIDGE_OVERRIDE_CELL = 0.2;
const BRIDGE_SCAN_LIMIT = 512;

const smooth01 = (x) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

/**
 * Pure bridge-deck height-override contract. `flatHalfLength` covers the
 * measured wet run; the remaining visible length is a timber approach that
 * eases down to dry natural ground. No query support exists beyond the planks.
 */
export function makeBridgeDeckProfile(center, across, length, flatHalfLength, getGroundHeight) {
  const halfLength = length * 0.5;
  const halfWidth = BRIDGE_WIDTH * 0.5;
  const sideX = -across.z, sideZ = across.x;
  const deckY = center.y + 0.22; // plank centre 0.13 + half its 0.18 m thickness
  const rampLength = Math.max(0.001, halfLength - flatHalfLength);
  let plankCount = Math.max(3, Math.ceil(length / 0.68));
  if (plankCount % 2 === 0) plankCount++; // keep one nominal-height board centred at z=0
  const plankPitch = length / plankCount;

  const bankHeight = (sign) => {
    let y = -Infinity;
    for (const lx of [-halfWidth * 0.78, 0, halfWidth * 0.78]) {
      const lz = sign * halfLength;
      const x = center.x + across.x * lz + sideX * lx;
      const z = center.z + across.z * lz + sideZ * lx;
      y = Math.max(y, getGroundHeight(x, z));
    }
    return Math.min(deckY, y + 0.04);
  };
  const endY0 = bankHeight(-1), endY1 = bankHeight(1);

  const smoothSurfaceAtLocalZ = (z) => {
    const az = Math.abs(z);
    if (az > halfLength) return null;
    const k = az <= flatHalfLength
      ? 1
      : smooth01((halfLength - az) / rampLength);
    const endY = z < 0 ? endY0 : endY1;
    return endY + (deckY - endY) * k + Math.sin(z * 0.41) * 0.025 * k;
  };
  const plankCenterAt = (i) => -halfLength + (i + 0.5) * plankPitch;
  const plankIndexAt = (z) => Math.max(0, Math.min(plankCount - 1,
    Math.floor((z + halfLength) / plankPitch)));
  // Every rendered board is an unpitched box. Quantising the query to the same
  // centre-top gives an exact piecewise-flat support surface under each board.
  const surfaceAtLocalZ = (z) => {
    if (Math.abs(z) > halfLength) return null;
    return smoothSurfaceAtLocalZ(plankCenterAt(plankIndexAt(z)));
  };

  const toLocal = (x, z) => {
    const dx = x - center.x, dz = z - center.z;
    return {
      x: dx * sideX + dz * sideZ,
      z: dx * across.x + dz * across.z,
    };
  };
  const contains = (x, z) => {
    const p = toLocal(x, z);
    return Math.abs(p.x) <= halfWidth && Math.abs(p.z) <= halfLength;
  };

  return {
    halfLength, halfWidth, flatHalfLength, rampLength, deckY, endY0, endY1,
    plankCount, plankPitch, plankCenterAt,
    surfaceAtLocalZ, smoothSurfaceAtLocalZ, contains,
    bound: Math.hypot(halfLength, halfWidth) + BRIDGE_OVERRIDE_CELL,
    sample(x, z) {
      const p = toLocal(x, z);
      const ax = Math.abs(p.x), az = Math.abs(p.z);
      if (ax > halfWidth || az > halfLength) {
        return { y: 0, w: 0 };
      }
      return { y: surfaceAtLocalZ(p.z), w: 1 };
    },
  };
}

/** Build a rustic log-and-plank footbridge across the water view's wet run. */
export function buildLogBridge(ctx) {
  const water = ctx.get('water');
  const poi = ctx.poi.get('river');
  if (!water || !poi || !water.depthAt) return null;
  const cam = (poi.pos || poi).clone();
  const look = (poi.look || ctx.poi.get('river_down')?.pos || poi).clone();
  const across = look.clone().sub(cam); across.y = 0;
  if (across.lengthSq() < 1) across.set(1, 0, 0);
  across.normalize();

  // Locate the centre of the first wet run seen from the canonical river bank.
  let first = null, last = null, clearedFarBank = false;
  for (let d = 0; d <= BRIDGE_SCAN_LIMIT; d += 1) {
    const x = cam.x + across.x * d, z = cam.z + across.z * d;
    if (water.depthAt(x, z) > 0.04) {
      if (first == null) first = d;
      last = d;
    } else if (first != null && last != null && d - last > BRIDGE_APPROACH) {
      clearedFarBank = true;
      break;
    }
  }
  if (first == null || last == null || !clearedFarBank) return null;

  // Keep equal-length approaches so the measured wet run remains centred, and
  // extend them if a coarse one-metre wet/dry sample still lands in water.
  let approach = BRIDGE_APPROACH;
  for (; approach <= 64; approach += 1) {
    const d0 = first - approach, d1 = last + approach;
    const wet0 = water.depthAt(cam.x + across.x * d0, cam.z + across.z * d0) > 0.04;
    const wet1 = water.depthAt(cam.x + across.x * d1, cam.z + across.z * d1) > 0.04;
    if (!wet0 && !wet1) break;
  }
  if (approach > 64) return null;
  const wetSpan = last - first;
  const length = Math.max(8, wetSpan + approach * 2);
  const midD = (first + last) * 0.5;
  const center = cam.clone().addScaledVector(across, midD);
  const surface = water.surfaceHeightAt(center.x, center.z);
  center.y = (surface == null ? ctx.world.getHeight(center.x, center.z) : surface) + 0.78;
  const terrain = ctx.get('terrain');
  const groundHeight = ctx.world.getHeight.bind(ctx.world);
  const deck = makeBridgeDeckProfile(center, across, length, wetSpan * 0.5, groundHeight);
  let heightOverride = null;
  if (terrain && terrain.addHeightOverride) {
    heightOverride = terrain.addHeightOverride({
      cx: center.x,
      cz: center.z,
      bound: deck.bound,
      cell: BRIDGE_OVERRIDE_CELL,
      sample: (x, z) => deck.sample(x, z),
      contains: (x, z) => deck.contains(x, z),
      heightAt: (x, z) => deck.sample(x, z).y,
    });
  }

  const group = new THREE.Group();
  group.name = 'log_bridge';
  group.position.copy(center);
  group.rotation.y = Math.atan2(across.x, across.z);
  const wood = new THREE.MeshStandardMaterial({ color: 0x493021, roughness: 0.98 });
  const rope = new THREE.MeshStandardMaterial({ color: 0x8e7650, roughness: 1.0 });
  const geos = [];
  const meshes = [];
  const add = (geo, material, x, y, z, sx, sy, sz) => {
    if (!geos.includes(geo)) geos.push(geo);
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z); m.scale.set(sx, sy, sz);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m); meshes.push(m); return m;
  };
  const log = new THREE.CylinderGeometry(0.5, 0.62, 1, 9);
  const plank = new THREE.BoxGeometry(1, 1, 1);
  geos.push(log, plank);
  const addBeam = (material, x, z0, y0, z1, y1, radius) => {
    const dz = z1 - z0, dy = y1 - y0;
    const span = Math.hypot(dz, dy);
    const m = add(log, material, x, (y0 + y1) * 0.5, (z0 + z1) * 0.5,
      radius, span, radius);
    m.quaternion.setFromUnitVectors(UP, new THREE.Vector3(0, dy, dz).normalize());
    return m;
  };
  const beamStep = 1.15;
  for (const x of [-1.05, 1.05]) {
    for (let z0 = -deck.halfLength; z0 < deck.halfLength - 1e-6; z0 += beamStep) {
      const z1 = Math.min(deck.halfLength, z0 + beamStep);
      addBeam(wood, x, z0, deck.smoothSurfaceAtLocalZ(z0) - center.y - 0.40,
        z1, deck.smoothSurfaceAtLocalZ(z1) - center.y - 0.40, 0.42);
    }
  }
  const plankSurfaces = [];
  for (let i = 0; i < deck.plankCount; i++) {
    const z = deck.plankCenterAt(i);
    const topY = deck.surfaceAtLocalZ(z);
    const p = add(plank, wood, 0,
      topY - center.y - 0.09,
      z, BRIDGE_WIDTH, 0.18, deck.plankPitch);
    plankSurfaces.push({ index: i, centerZ: z, topY, halfDepth: deck.plankPitch * 0.5 });
  }
  for (const x of [-1.55, 1.55]) {
    for (let z = -deck.halfLength; z <= deck.halfLength; z += 3.1) {
      add(log, wood, x, deck.smoothSurfaceAtLocalZ(z) - center.y + 0.53,
        z, 0.14, 1.55, 0.14);
    }
    for (let z0 = -deck.halfLength; z0 < deck.halfLength - 1e-6; z0 += beamStep) {
      const z1 = Math.min(deck.halfLength, z0 + beamStep);
      addBeam(rope, x, z0, deck.smoothSurfaceAtLocalZ(z0) - center.y + 1.28,
        z1, deck.smoothSurfaceAtLocalZ(z1) - center.y + 1.28, 0.075);
    }
  }
  // Collapse repeated planks/posts into one draw per material, as with shrine.
  group.updateMatrixWorld(true);
  const buckets = new Map();
  group.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    if (!buckets.has(o.material)) buckets.set(o.material, []);
    buckets.get(o.material).push(g);
  });
  group.clear();
  group.position.set(0, 0, 0);
  group.rotation.set(0, 0, 0);
  for (const g of geos) g.dispose();
  geos.length = 0;
  meshes.length = 0;
  for (const [material, parts] of buckets) {
    const merged = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    geos.push(merged);
    const m = new THREE.Mesh(merged, material);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m); meshes.push(m);
  }
  ctx.scene.add(group);
  const lighting = ctx.get('lighting');
  if (lighting && lighting.requestShadowCaster) {
    for (const m of meshes) lighting.requestShadowCaster(m);
  }
  // Make the water shot judge the bridge, not an arbitrary empty bend.
  const side = new THREE.Vector3(-across.z, 0, across.x);
  const bridgeCam = center.clone().addScaledVector(across, -length * 0.43)
    .addScaledVector(side, 8.5);
  bridgeCam.y = ctx.world.getHeight(bridgeCam.x, bridgeCam.z) + 2.2;
  ctx.poi.set('river', { pos: bridgeCam, look: center.clone().add(new THREE.Vector3(0, 0.35, 0)) });
  ctx.poi.set('river_down', { pos: center.clone().addScaledVector(across, length * 0.34), look: center });
  return {
    group, mats: [wood, rope], geos, meshes, center, length, wetSpan, approach,
    deck, plankSurfaces,
    terrain, heightOverride,
  };
}
