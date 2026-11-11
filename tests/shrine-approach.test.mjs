import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { Physics } from '../src/sim/Physics.js';
import { Scatter } from '../src/world/Scatter.js';
import {
  SHRINE_APPROACH, SHRINE_TERMINAL, makeShrineTerminal, makeShrineWalkSurface,
  planGuardianStones, resolveShrineAxis,
} from '../src/world/town/JapaneseShrine.js';

const seeded = (seed = 1) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};

const close = (actual, expected, epsilon = 1e-5) => {
  assert.ok(Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`);
};

test('shrine approach follows the visible contour and keeps dressing outside the avenue', () => {
  const terrain = {
    townSite: { dir: new THREE.Vector3(1, 0, 0) },
    townPad: { bearing: [0, 1] },
  };
  const axis = resolveShrineAxis(terrain);
  assert.ok(axis.distanceTo(new THREE.Vector2(1, 0)) < 1e-8,
    'the route must follow the visible terrain contour, not the unrendered legacy pad');

  for (const stone of planGuardianStones(seeded(0x4a504e31), 256)) {
    const innerEdge = Math.abs(stone.x) - stone.r * 1.35;
    assert.ok(innerEdge >= SHRINE_APPROACH.guardianInnerEdge - 1e-8);
    assert.ok(innerEdge > SHRINE_APPROACH.routeHalfWidth,
      `guardian stone footprint intrudes into route at x=${stone.x}`);
  }
});

test('scatter acquires the shrine keep-out after its earlier init pass', () => {
  const systems = new Map();
  const ctx = {
    poi: new Map([['camp_fire', { pos: new THREE.Vector3(4, 0, 5) }]]),
    get: (id) => systems.get(id),
  };
  const scatter = new Scatter(ctx);

  scatter._resolveAuthoredClearings();
  assert.equal(scatter._townOnStreet, undefined,
    'Town is intentionally unavailable during Scatter init');
  assert.ok(scatter._campR2 > 0, 'the fallback camp POI reproduces the old cache guard');

  const onStreet = (x, z, padding = 0) => Math.abs(x) < 9 + padding
    && z > -58 - padding && z < 48 + padding;
  systems.set('town', { site: { onStreet } });
  scatter._resolveAuthoredClearings();
  assert.equal(scatter._townOnStreet, onStreet,
    'a later stream pass must acquire the route predicate independently');
  assert.equal(scatter._townOnStreet(0, 0), true);
  assert.equal(scatter._townOnStreet(12, 0, 4), true,
    'route predicates must accept prop-footprint padding');
});

test('rendered shrine stair tops are the character ground throughout the ascent', () => {
  const surface = makeShrineWalkSurface();
  const expected = [0.495, 0.495, 0.65, 0.81, 0.97];
  for (let i = 0; i < expected.length; i++) {
    const z = 27.6 + i * 0.72;
    // Approach/forecourt slabs overlap the first steps; the same max-depth
    // rule is used by both renderer and query surface.
    close(surface.surfaceAtLocal(0, z), expected[i]);
  }
  close(surface.surfaceAtLocal(0, 31.0), 0.97);
  close(surface.surfaceAtLocal(0, 31.5), 1.145);

  const world = {
    ready: true,
    getHeight(x, z) { return surface.heightAt(x, z) ?? 0; },
    getNormal(x, z, target = new THREE.Vector3()) {
      const e = 2.6; // Terrain's production normal footprint
      return target.set(
        this.getHeight(x - e, z) - this.getHeight(x + e, z), 2 * e,
        this.getHeight(x, z - e) - this.getHeight(x, z + e),
      ).normalize();
    },
  };
  const physics = new Physics({ world });
  const state = {
    position: new THREE.Vector3(0, world.getHeight(0, 26.4), 26.4),
    velocity: new THREE.Vector3(0, 0, 3.8),
    radius: 0.30, height: 1.8, stepHeight: 0.45, maxSlopeCos: 0.58,
    snap: 0.9, grounded: true, groundNormal: new THREE.Vector3(0, 1, 0),
  };
  for (let i = 0; i < 240 && state.position.z < 32; i++) {
    state.velocity.x = 0; state.velocity.z = 3.8;
    physics.stepCharacter(state, 1 / 60);
    close(state.position.y, world.getHeight(state.position.x, state.position.z), 0.025);
  }
  assert.ok(state.position.z >= 32, `controller stalled on shrine stairs at z=${state.position.z}`);
  assert.equal(state.grounded, true);
});

test('closed shrine facade is a grounded, queryable terminal stop', () => {
  const authored = { cx: 120, cz: -80, yaw: 0.645, baseY: 4 };
  const surface = makeShrineWalkSurface(authored);
  const terminal = makeShrineTerminal(authored);
  const route = new THREE.Vector3(Math.sin(authored.yaw), 0, Math.cos(authored.yaw));
  assert.ok(terminal.clearanceZ - SHRINE_APPROACH.endZ > 0.3,
    'the semantic endpoint must leave at least one player radius before the facade');
  close(terminal.endpoint.y, surface.surfaceAtLocal(0, SHRINE_APPROACH.endZ));

  const world = {
    ready: true,
    getHeight(x, z) { return surface.heightAt(x, z) ?? 0; },
    getNormal(x, z, target = new THREE.Vector3()) { return target.set(0, 1, 0); },
  };
  const physics = new Physics({ world, get: () => null });
  for (const collider of terminal.colliders) {
    physics.addCollider({ ...collider, mask: physics.LAYER.WORLD });
  }

  const side = new THREE.Vector3(Math.cos(authored.yaw), 0, -Math.sin(authored.yaw));
  for (const sideSign of [-1, 1]) {
    const state = {
      position: terminal.endpoint.clone(),
      velocity: route.clone().multiplyScalar(6.8),
      radius: 0.30, height: 1.8, stepHeight: 0.45, maxSlopeCos: 0.58,
      snap: 0.9, grounded: true, groundNormal: new THREE.Vector3(0, 1, 0),
    };
    // A harder version of Player._antiStuck: for a full minute, always nudge
    // toward the same return instead of alternating away from a trapped corner.
    for (let i = 0; i < 3600; i++) {
      state.velocity.copy(route).multiplyScalar(6.8);
      physics.stepCharacter(state, 1 / 60);
      if ((i + 1) % 90 === 0) state.position.addScaledVector(side, sideSign * 0.55);
    }
    state.velocity.copy(route).multiplyScalar(6.8);
    physics.stepCharacter(state, 1 / 60); // resolve the final post-physics nudge

    const stopped = surface.toLocal(state.position.x, state.position.z);
    const maxCenterZ = SHRINE_TERMINAL.facadeZ - SHRINE_TERMINAL.halfDepth - state.radius;
    const maxCenterX = SHRINE_TERMINAL.returnX - SHRINE_TERMINAL.returnHalfWidth - state.radius;
    assert.ok(stopped.z <= maxCenterZ + 1e-5,
      `controller escaped behind the sanctuary at local z=${stopped.z}`);
    assert.ok(Math.abs(stopped.x) <= maxCenterX + 1e-5,
      `controller escaped around the sanctuary return at local x=${stopped.x}`);
    assert.ok(stopped.z >= SHRINE_APPROACH.endZ,
      'the stop should remain on the destination deck, not shove the player back down the stairs');
    close(state.position.y, world.getHeight(state.position.x, state.position.z), 1e-6);
    assert.equal(state.grounded, true);
  }

  const cameraProbe = physics.sphereCast(
    terminal.endpoint.clone().setY(authored.baseY + 2.8),
    route,
    0.45,
    4,
  );
  assert.ok(cameraProbe, 'follow-camera sphere cast must see the closed facade');
  assert.equal(cameraProbe.tag, 'shrine_facade');
});
