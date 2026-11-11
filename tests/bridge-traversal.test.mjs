import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { Physics } from '../src/sim/Physics.js';
import { Terrain } from '../src/world/Terrain.js';
import { buildLogBridge } from '../src/world/town/JapaneseShrine.js';

const close = (actual, expected, epsilon = 1e-4) => {
  assert.ok(Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`);
};

function makeBridgeHarness() {
  // Regression fixture from the deterministic production river: the old 46 m
  // cap ended at +/-23 m where depth remained about 0.75 m, and even +/-26 m
  // was still wet. Dry banks begin beyond that measured run.
  const rawHeight = (x) => Math.min(2, Math.max(0, (Math.abs(x) - 26) * 0.67));
  let overrideSpec = null;
  const terrain = {
    addHeightOverride(spec) { overrideSpec = spec; return { spec }; },
    removeHeightOverride() {},
  };
  const water = {
    depthAt: (x) => {
      const a = Math.abs(x);
      if (a <= 23) return 0.75;
      if (a <= 26) return 0.58;
      return 0;
    },
    surfaceHeightAt: () => 2,
  };
  const poi = new Map([
    ['river', { pos: new THREE.Vector3(-40, 2, 0), look: new THREE.Vector3(40, 2, 0) }],
  ]);
  const systems = new Map([['water', water], ['terrain', terrain]]);
  const ctx = {
    scene: new THREE.Scene(),
    poi,
    world: { getHeight: (x, z) => rawHeight(x, z) },
    get: (id) => systems.get(id),
  };
  const bridge = buildLogBridge(ctx);
  return { bridge, overrideSpec, rawHeight, water };
}

/** Bake and query an override with Terrain's production registration path. */
function makeWorld(rawHeight, overrideSpec) {
  const terrain = { _rawHeight: rawHeight, _overrides: [] };
  const ov = Terrain.prototype.addHeightOverride.call(terrain, overrideSpec);
  const getHeight = (x, z) => {
    const base = rawHeight(x, z);
    if (x < ov.x0 || x > ov.x1 || z < ov.z0 || z > ov.z1) return base;
    if (ov.contains && !ov.contains(x, z)) return base;
    if (ov.heightAt) return Math.max(base, ov.heightAt(x, z));
    const fx = (x - ov.x0) / ov.cell, fz = (z - ov.z0) / ov.cell;
    let ix = fx | 0, iz = fz | 0;
    if (ix > ov.n - 2) ix = ov.n - 2;
    if (iz > ov.n - 2) iz = ov.n - 2;
    const tx = fx - ix, tz = fz - iz;
    const d = ov.data, r0 = iz * ov.n + ix, r1 = r0 + ov.n;
    const a = d[r0], b = d[r0 + 1], c = d[r1], e = d[r1 + 1];
    const t0 = a + (b - a) * tx;
    return base + t0 + ((c + (e - c) * tx) - t0) * tz;
  };
  const getNormal = (x, z, target = new THREE.Vector3()) => {
    const e = 2.6;
    return target.set(
      getHeight(x - e, z) - getHeight(x + e, z),
      2 * e,
      getHeight(x, z - e) - getHeight(x, z + e),
    ).normalize();
  };
  return { getHeight, getNormal, ready: true };
}

function crossBridge(world, bridge, radius, height, stepHeight, maxSlopeCos, speed, direction) {
  const physics = new Physics({ world });
  const start = bridge.center.x - direction * (bridge.deck.halfLength + 0.3);
  const finish = bridge.center.x + direction * (bridge.deck.halfLength + 0.3);
  const state = {
    position: new THREE.Vector3(start, world.getHeight(start, 0), 0),
    velocity: new THREE.Vector3(speed * direction, 0, 0),
    radius, height, stepHeight, maxSlopeCos,
    snap: 0.9,
    grounded: true,
    groundNormal: new THREE.Vector3(0, 1, 0),
  };
  let highest = -Infinity;
  const unfinished = () => direction > 0 ? state.position.x < finish : state.position.x > finish;
  for (let i = 0; i < 2000 && unfinished(); i++) {
    // Player and Horse continuously author horizontal velocity before handing
    // their state to this same controller in production.
    state.velocity.x = speed * direction;
    state.velocity.z = 0;
    physics.stepCharacter(state, 1 / 60);
    highest = Math.max(highest, state.position.y);
    close(state.position.y, world.getHeight(state.position.x, state.position.z), 0.03);
  }
  assert.equal(unfinished(), false, `controller stopped at x=${state.position.x}`);
  assert.ok(highest > 2.9, `controller never reached the raised deck (max y=${highest})`);
  assert.equal(state.grounded, true);
}

test('bridge publishes a narrow deck aligned to its visible top without changing water data', () => {
  const { bridge, overrideSpec, rawHeight, water } = makeBridgeHarness();
  assert.ok(bridge);
  assert.ok(overrideSpec, 'bridge must register Terrain.addHeightOverride');
  assert.ok(overrideSpec.cell <= 0.2, 'narrow deck needs a sub-plank override grid');
  assert.ok(bridge.length > 46, 'measured wet span must not be truncated by the old cap');

  const centre = bridge.deck.sample(bridge.center.x, bridge.center.z);
  assert.equal(centre.w, 1);
  close(centre.y, 3.0); // water 2 + root 0.78 + plank centre 0.13 + half-depth 0.09

  const sideEdge = bridge.deck.sample(0, bridge.deck.halfWidth);
  assert.equal(sideEdge.w, 1, 'the full 2.9 m visible deck must remain solid');
  const sideOutside = bridge.deck.sample(0, bridge.deck.halfWidth + 0.01);
  assert.equal(sideOutside.w, 0, 'normal terrain must remain untouched outside visible planks');
  const endOutside = bridge.deck.sample(bridge.deck.halfLength + 0.01, 0);
  assert.equal(endOutside.w, 0, 'override support must stop at the visible bridge endpoint');

  assert.equal(water.depthAt(-23, 0), 0.75);
  assert.equal(water.depthAt(23, 0), 0.75);
  assert.equal(water.depthAt(-26, 0), 0.58);
  assert.equal(water.depthAt(26, 0), 0.58);
  assert.ok(water.depthAt(bridge.center.x - bridge.deck.halfLength, 0) <= 0.04,
    'near visible endpoint must land on a dry bank');
  assert.ok(water.depthAt(bridge.center.x + bridge.deck.halfLength, 0) <= 0.04,
    'far visible endpoint must land on a dry bank');
  assert.ok(bridge.deck.surfaceAtLocalZ(bridge.deck.halfLength - 0.1) < bridge.deck.deckY,
    'bank transition must be inside the visible plank span');

  assert.equal(water.depthAt(0, 0), 0.75, 'query-only deck must not alter baked river flow/depth');
  assert.equal(water.surfaceHeightAt(0, 0), 2);
});

test('production geometry and query agree across every approach plank', () => {
  const { bridge, overrideSpec, rawHeight } = makeBridgeHarness();
  const world = makeWorld(rawHeight, overrideSpec);
  const justPastEnd = bridge.center.x + bridge.deck.halfLength + 0.01;
  const justPastSide = bridge.center.z + bridge.deck.halfWidth + 0.01;
  close(world.getHeight(justPastEnd, bridge.center.z), rawHeight(justPastEnd, bridge.center.z));
  close(world.getHeight(bridge.center.x, justPastSide), rawHeight(bridge.center.x, justPastSide));
  for (const p of bridge.plankSurfaces) {
    if (Math.abs(p.centerZ) <= bridge.deck.flatHalfLength) continue;
    for (const dz of [-p.halfDepth * 0.8, 0, p.halfDepth * 0.8]) {
      close(world.getHeight(bridge.center.x + p.centerZ + dz, bridge.center.z), p.topY);
    }
  }
});

test('production capsule controller carries player and horse over the bridge both ways', () => {
  const { bridge, overrideSpec, rawHeight } = makeBridgeHarness();
  const world = makeWorld(rawHeight, overrideSpec);
  for (const direction of [-1, 1]) {
    crossBridge(world, bridge, 0.30, 1.8, 0.45, 0.58, 4.2, direction); // Player
    crossBridge(world, bridge, 0.55, 1.7, 0.55, 0.55, 7.0, direction); // Horse
  }
});
