import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const ASSET_URL = '/assets/ronin.glb';
const WALK_SPEED = 1.62;
const TAU = Math.PI * 2;
// Measured from the staged GLB: Hips is 0.909 m above its ground plane.
// Player's saddle contract puts the seated hip 0.115 m above the saddle bone.
const SADDLE_OFFSET = 0.909 - 0.115;
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

const clamp01 = (x) => THREE.MathUtils.clamp(x, 0, 1);
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * Visible hero layer for Player.
 *
 * Player's original procedural rig remains alive as an invisible animation
 * proxy: its terrain IK, saddle attachment and weapon anchors are deeply tied
 * into gameplay. This class replaces only the rendered body and lets the
 * authored GLB clips follow those proven root transforms.
 */
export class RoninAvatar {
  constructor(ctx, player) {
    this.ctx = ctx;
    this.player = player;
    this.root = null;
    this.mixer = null;
    this.actions = {};
    this.current = null;
    this.ready = false;
    this.meshes = [];
    this.bones = {};
    this.limbs = [];
    this.poseBones = [];
    this.basePose = [];
    this._overlayQ = new THREE.Quaternion();
  }

  async init(parent) {
    const gltf = await new GLTFLoader().loadAsync(ASSET_URL);
    this.root = gltf.scene;
    this.root.name = 'roninAvatar';
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);

    const sky = this.ctx.get('sky');
    const lighting = this.ctx.get('lighting');
    const maxAniso = this.ctx.renderer && this.ctx.renderer.capabilities
      ? Math.min(8, this.ctx.renderer.capabilities.getMaxAnisotropy())
      : 1;
    const materials = new Set();
    this.root.traverse((object) => {
      if (!object.isMesh) return;
      object.name = object.name || 'roninMesh';
      object.castShadow = true;
      object.receiveShadow = true;
      object.frustumCulled = false;
      this.meshes.push(object);
      if (lighting && lighting.requestShadowCaster) lighting.requestShadowCaster(object);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!material || materials.has(material)) continue;
        materials.add(material);
        // Preserve the authored PBR response while keeping fine armor weave
        // stable at the wider chase-camera distance.
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) {
          if (material[key]) material[key].anisotropy = maxAniso;
        }
        if (sky && sky.injectAerialPerspective) sky.injectAerialPerspective(material);
      }
    });

    this.mixer = new THREE.AnimationMixer(this.root);
    const byName = new Map(gltf.animations.map((clip) => [clip.name.toLowerCase(), clip]));
    for (const name of ['idle', 'walk', 'mount', 'ride']) {
      const clip = byName.get(name);
      if (!clip) throw new Error(`ronin.glb is missing required animation: ${name}`);
      const action = this.mixer.clipAction(clip);
      action.enabled = true;
      action.setEffectiveWeight(0);
      if (name === 'mount') {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      } else {
        action.setLoop(THREE.LoopRepeat, Infinity);
      }
      this.actions[name] = action;
    }

    for (const name of [
      'Hips', 'Spine02', 'Spine01', 'Spine',
      'LeftUpLeg', 'LeftLeg', 'RightUpLeg', 'RightLeg',
      'LeftArm', 'LeftForeArm', 'RightArm', 'RightForeArm',
    ]) {
      const bone = this.root.getObjectByName(name);
      if (!bone) throw new Error(`ronin.glb is missing required bone: ${name}`);
      this.bones[name] = bone;
    }
    this.limbs = [
      {
        sign: 1, phaseOffset: 0,
        upLeg: this.bones.LeftUpLeg, leg: this.bones.LeftLeg,
        arm: this.bones.LeftArm, foreArm: this.bones.LeftForeArm,
      },
      {
        sign: -1, phaseOffset: Math.PI,
        upLeg: this.bones.RightUpLeg, leg: this.bones.RightLeg,
        arm: this.bones.RightArm, foreArm: this.bones.RightForeArm,
      },
    ];
    this.poseBones = [
      this.bones.Hips, this.bones.Spine02,
      this.bones.LeftUpLeg, this.bones.LeftLeg,
      this.bones.RightUpLeg, this.bones.RightLeg,
      this.bones.LeftArm, this.bones.LeftForeArm,
      this.bones.RightArm, this.bones.RightForeArm,
    ];
    for (let i = 0; i < this.poseBones.length; i++) this.basePose.push(new THREE.Quaternion());

    parent.add(this.root);
    this.ready = true;
    this._playLoop('idle', 0);
    this.mixer.update(0);
    this._captureAuthoredPose();
    return this;
  }

  _playLoop(name, fade = 0.18) {
    if (this.current === name) return;
    const previous = this.current && this.actions[this.current];
    const next = this.actions[name];
    if (!next) return;

    next.paused = false;
    next.enabled = true;
    next.reset().setEffectiveWeight(1).play();
    if (previous && fade > 0) previous.crossFadeTo(next, fade, true);
    else {
      for (const action of Object.values(this.actions)) action.setEffectiveWeight(action === next ? 1 : 0);
    }
    this.current = name;
  }

  _poseMount(transition) {
    const action = this.actions.mount;
    if (this.current !== 'mount') {
      for (const other of Object.values(this.actions)) other.setEffectiveWeight(other === action ? 1 : 0);
      action.reset().play();
      action.paused = true;
      this.current = 'mount';
    }

    // The controller may include a short walk-in lead. Keep frame zero during
    // that lead, then map the authored clip exactly across the core timeline.
    const u = clamp01((transition.t - transition.lead) / transition.core);
    const authoredU = transition.kind === 'dismount' ? 1 - u : u;
    action.time = action.getClip().duration * authoredU;
    this.mixer.update(0);
  }

  _axis(bone, axis, radians) {
    if (Math.abs(radians) < 1e-5) return;
    this._overlayQ.setFromAxisAngle(axis, radians);
    bone.quaternion.multiply(this._overlayQ);
  }

  _restoreAuthoredPose() {
    for (let i = 0; i < this.poseBones.length; i++) {
      this.poseBones[i].quaternion.copy(this.basePose[i]);
    }
  }

  _captureAuthoredPose() {
    for (let i = 0; i < this.poseBones.length; i++) {
      this.basePose[i].copy(this.poseBones[i].quaternion);
    }
  }

  /**
   * The staged locomotion clips intentionally remain the base actions, but
   * their joint curves are almost static (the largest walk/ride bone delta is
   * about 0.001 rad). Add a restrained, allocation-free pose layer so actual
   * ground speed reads in the silhouette and the ride pose meets the irons.
   */
  _overlayLocomotion() {
    const player = this.player;
    const speed01 = clamp01(player.speed01 || 0);
    const walkK = clamp01((speed01 - 0.025) / 0.22) * (1 - clamp01(player.mountBlend || 0));
    const runK = clamp01((speed01 - 0.34) / 0.66);
    const rideK = clamp01(player.mountBlend || 0);
    const groundTransition = player.trans ? 1 - rideK : 0;
    const phase = (player.gaitPhase || 0) * TAU;
    const stride = (0.34 + runK * 0.24) * walkK;

    for (let i = 0; i < this.limbs.length; i++) {
      const limb = this.limbs[i];
      const legPhase = phase + limb.phaseOffset;
      const wave = Math.sin(legPhase);
      const lift = Math.max(0, -wave);

      // Local X is fore/aft on this exported Mixamo rig; local Z opens the
      // knee away from the barrel. The fixed ride values place the boots at
      // x=+/-0.30 and y=-0.71 from the hip, matching Horse's +/-0.32 irons.
      this._axis(limb.upLeg, AXIS_X, wave * stride - 0.42 * rideK);
      this._axis(limb.upLeg, AXIS_Z, -limb.sign * 0.16 * rideK);
      this._axis(limb.leg, AXIS_X,
        (0.08 + lift * (0.34 + runK * 0.24)) * walkK + 0.72 * rideK);

      // Narrow the authored walk's broad arm stance, then swing opposite the
      // same-side leg. In the saddle these measured angles put both hands over
      // the horn/reins without any world-space IK or temporary objects.
      const natural = Math.max(walkK, groundTransition);
      this._axis(limb.arm, AXIS_X, -wave * (0.26 + runK * 0.18) * walkK);
      this._axis(limb.arm, AXIS_Z, limb.sign * (0.28 * natural + 0.75 * rideK));
      this._axis(limb.foreArm, AXIS_Z, limb.sign * (0.12 * natural + 0.45 * rideK));
    }

    this._axis(this.bones.Spine02, AXIS_X,
      (0.025 + runK * 0.065) * walkK + 0.055 * rideK);
    this._axis(this.bones.Spine02, AXIS_Z, Math.sin(phase) * 0.025 * walkK);

    // The horse root already supplies the large body motion; this is only the
    // rider absorbing it through the seat. On foot it is a subtle weight drop
    // at each plant, not a second source of world locomotion.
    if (rideK > 0.001) {
      const horse = this.ctx.player.horse;
      const horsePhase = horse ? (horse.gaitPhase || 0) * TAU : phase;
      this.root.position.y += Math.sin(horsePhase * 2) * (0.006 + speed01 * 0.012) * rideK;
    } else if (walkK > 0.001) {
      this.root.position.y -= Math.abs(Math.cos(phase)) * (0.007 + runK * 0.012) * walkK;
    }
  }

  /**
   * Contact choreography layered over the (near-static) authored mount clip.
   *
   * These phase laws deliberately mirror Player._poseTransition: the left
   * boot owns the near stirrup before weight transfer, the right leg crosses
   * later over the croup, and both operations happen in the opposite support
   * order on dismount. The overlay only rotates cached bones; Player continues
   * to own the root path, saddle quaternion, mount beats and support change.
   */
  _overlayMountTransition(transition) {
    const c = transition.t - transition.lead;
    const mounting = transition.kind === 'mount';
    const seat = clamp01(this.player.mountBlend || 0);
    let stirrup;
    let sweep;
    let leftHand;
    let rightHand;
    let settle;

    if (mounting) {
      stirrup = smoothstep(0.02, 0.28, c);
      sweep = smoothstep(0.34, 1.02, c);
      leftHand = smoothstep(-0.12, 0.12, c) * (1 - smoothstep(0.90, 1.16, c));
      rightHand = smoothstep(0.10, 0.34, c) * (1 - smoothstep(0.92, 1.16, c));
      settle = smoothstep(0.80, 1.03, c) * (1 - smoothstep(1.03, 1.22, c));
    } else {
      stirrup = 1 - smoothstep(0.74, 0.96, c);
      sweep = 1 - smoothstep(0.08, 0.56, c);
      // Stay braced while the far leg clears, then release the horn as the
      // near boot finally comes out of the iron.
      leftHand = 1 - smoothstep(0.62, 0.95, c);
      rightHand = 1 - smoothstep(0.48, 0.86, c);
      settle = smoothstep(0.82, 1.02, c) * (1 - smoothstep(1.02, 1.11, c));
    }

    const left = this.limbs[0];
    const right = this.limbs[1];
    const leftDelta = stirrup - seat;
    const rightDelta = sweep - seat;
    const stirrupArc = Math.sin(Math.PI * clamp01(stirrup));
    const croupArc = Math.sin(Math.PI * clamp01(sweep));
    const reach = Math.sin(Math.PI * seat);

    /* Near side: commit the LEFT boot to the iron before the pelvis rises.
     * Adding only the difference from `seat` replaces the symmetric riding
     * blend already applied by _overlayLocomotion, so it cannot double-pose. */
    this._axis(left.upLeg, AXIS_X, -0.42 * leftDelta - 0.08 * stirrupArc);
    this._axis(left.upLeg, AXIS_Z, -0.16 * leftDelta - 0.05 * stirrupArc);
    this._axis(left.leg, AXIS_X, 0.72 * leftDelta + 0.20 * stirrupArc);

    /* Far side: keep the RIGHT leg grounded until its own phase, fold it hard,
     * open it away from the barrel and carry the boot backward over the croup.
     * The sine arc is zero at both contacts, so mount->ride and
     * ride->dismount boundaries remain continuous. */
    this._axis(right.upLeg, AXIS_X, -0.42 * rightDelta + 1.05 * croupArc);
    this._axis(right.upLeg, AXIS_Z, 0.16 * rightDelta + 0.38 * croupArc);
    this._axis(right.leg, AXIS_X, 0.72 * rightDelta + 0.52 * croupArc);

    /* Hands and torso make the support story readable from the chase camera:
     * left reaches first, right braces after it, and the body folds toward the
     * horn while the far leg is airborne. All pulses fade before transition
     * completion, leaving the established ride pose untouched. */
    this._axis(left.arm, AXIS_Z, 0.30 * leftHand);
    this._axis(left.foreArm, AXIS_Z, 0.20 * leftHand);
    this._axis(right.arm, AXIS_Z, -0.21 * rightHand);
    this._axis(right.foreArm, AXIS_Z, -0.16 * rightHand);
    this._axis(this.bones.Spine02, AXIS_X,
      0.20 * reach + 0.08 * croupArc - 0.055 * settle);
    this._axis(this.bones.Spine02, AXIS_Z, 0.10 * reach + 0.08 * croupArc);
    this._axis(this.bones.Hips, AXIS_Z, 0.055 * reach + 0.035 * croupArc);
  }

  update(dt) {
    if (!this.ready) return;
    const player = this.player;
    this.root.position.y = -SADDLE_OFFSET * clamp01(player.mountBlend || 0);
    // AnimationMixer intentionally skips an unchanged binding write. Because
    // the staged locomotion curves are nearly constant, an external overlay
    // would otherwise become the next frame's base and compound indefinitely.
    // Restore the last mixer result first; capture the new result before this
    // frame's overlays. Both arrays are allocated once during init.
    this._restoreAuthoredPose();

    if (player.trans) {
      this._poseMount(player.trans);
      this._captureAuthoredPose();
      this._overlayLocomotion();
      this._overlayMountTransition(player.trans);
      return;
    }

    if (player.mode === 'mounted') {
      this._playLoop('ride', 0.20);
      this.actions.ride.setEffectiveTimeScale(0.72 + (player.speed01 || 0) * 0.78);
    } else if ((player.speed01 || 0) > 0.035) {
      this._playLoop('walk', 0.16);
      const speed = Math.hypot(player.state.velocity.x, player.state.velocity.z);
      this.actions.walk.setEffectiveTimeScale(THREE.MathUtils.clamp(speed / WALK_SPEED, 0.62, 2.35));
    } else {
      this._playLoop('idle', 0.24);
      this.actions.idle.setEffectiveTimeScale(1);
    }
    this.mixer.update(Math.min(dt || 0, 1 / 20));
    this._captureAuthoredPose();
    this._overlayLocomotion();
  }

  dispose() {
    if (!this.root) return;
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.root);
    }
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    this.root.traverse((object) => {
      if (!object.isMesh) return;
      if (object.geometry) geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!material) continue;
        materials.add(material);
        for (const value of Object.values(material)) if (value && value.isTexture) textures.add(value);
      }
    });
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
    for (const geometry of geometries) geometry.dispose();
    if (this.root.parent) this.root.parent.remove(this.root);
    this.ready = false;
  }
}
