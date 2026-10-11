import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type MutableRefObject } from "react";
import type { Drill, Position } from "../lib/dots";

const PLAYING_LENGTH_FEET = 300;
const FIELD_WIDTH_FEET = 160;
const STEP_SIZE_INCHES = 22.5;
const LABEL_PERFORMANCE_LIMIT = 180;
// Keep one stable InstancedMesh allocation across drill switches. Reusing the
// GPU buffers avoids temporarily holding two complete marcher scenes in memory
// while React replaces the old drill with the new one.
const INSTANCE_CAPACITY = 1024;
const LEG_LENGTH = 1.35;
const UPPER_ARM_LENGTH = 0.72;
const FOREARM_LENGTH = 0.68;
// Keep the performer soles just above the painted field surface.
const PERFORMER_GROUND_LIFT = 0.48;

function sqliteBool(value: unknown, fallback = true) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string")
    return ["1", "true", "yes"].includes(value.toLowerCase());
  return Boolean(value);
}

function parseColor(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  const m = value.match(/rgba?\(([^)]+)\)/);
  if (!m) return value;
  const parts = m[1].split(",").map(Number);
  if (parts.some((part) => Number.isNaN(part))) return fallback;
  return `rgb(${parts[0]},${parts[1]},${parts[2]})`;
}

function positionToField(p: Position, drill: Drill) {
  const stepSizeInches = drill.field.stepSizeInches || STEP_SIZE_INCHES;
  const widthPixels = drill.field.width || 1800;
  const heightPixels = drill.field.height || 960;
  const feetPerStep = stepSizeInches / 12;

  // OpenMarch's field width may include the end zones.  A high-school field
  // with end zones is 192 eight-to-five steps wide (-96..+96), while the
  // playing field alone is only 160 steps.  Treating every .dots width as
  // 160 steps compressed every marcher horizontally toward the 50.
  const xCheckpointSteps = (drill.field.xCheckpoints ?? [])
    .map((checkpoint) => Number(checkpoint.stepsFromCenterFront))
    .filter(Number.isFinite);
  const xStepSpan =
    xCheckpointSteps.length >= 2
      ? Math.max(...xCheckpointSteps) - Math.min(...xCheckpointSteps)
      : 160;

  const yCheckpointSteps = (drill.field.yCheckpoints ?? [])
    .map((checkpoint) => Number(checkpoint.stepsFromCenterFront))
    .filter(Number.isFinite);
  const yStepSpan =
    yCheckpointSteps.length >= 2
      ? Math.max(...yCheckpointSteps) - Math.min(...yCheckpointSteps)
      : 85.333333;

  const feetPerPixelX = (xStepSpan * feetPerStep) / widthPixels;
  const feetPerPixelY = (yStepSpan * feetPerStep) / heightPixels;
  const centerX = drill.field.centerFrontPoint?.xPixels ?? widthPixels / 2;
  const frontY = drill.field.centerFrontPoint?.yPixels ?? heightPixels;

  return {
    // OpenMarch X increases toward Side 2 while March3D's field X is mirrored
    // from the front-field camera, so preserve the existing sign convention.
    x: -(p.x - centerX) * feetPerPixelX,
    // OpenMarch Y is measured backfield from the front sideline.
    z: -FIELD_WIDTH_FEET / 2 + (frontY - p.y) * feetPerPixelY,
  };
}

export type TubaModel = "sousaphone" | "contrabassBugle";

type InstrumentKind =
  | "none"
  | "flute"
  | "clarinet"
  | "sax"
  | "trumpet"
  | "mello"
  | "baritone"
  | "trombone"
  | "tuba"
  | "snare"
  | "tenors"
  | "bass"
  | "cymbals"
  | "toms"
  | "flag"
  | "rifle"
  | "saber";

// Horn-down rotation in degrees for each instrument.
// Edit these values to customize how each instrument is held at rest.
const HORN_DOWN_ANGLES: Record<InstrumentKind, number> = {
  none: 0,
  flute: -20,
  clarinet: -15,
  sax: -30,
  trumpet: -90,
  mello: -60,
  baritone: -75,
  trombone: -65,
  tuba: -30,
  snare: 0,
  tenors: 0,
  bass: 0,
  cymbals: 0,
  toms: 0,
  flag: 0,
  rifle: 0,
  saber: 0,
};

function transformed<G extends THREE.BufferGeometry>(
  geometry: G,
  matrix: THREE.Matrix4,
) {
  geometry.applyMatrix4(matrix);
  return geometry;
}

function mergeParts(parts: THREE.BufferGeometry[]) {
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error("Unable to merge performer geometry");
  for (const part of parts) part.dispose();
  merged.computeVertexNormals();
  return merged;
}

function shakoGeometry() {
  // A real marching shako reads as a tall cylindrical hat with a short visor,
  // not a cone/party hat. The visor points toward local -Z (front field).
  const crown = new THREE.CylinderGeometry(0.34, 0.38, 0.5, 12);
  const visor = new THREE.BoxGeometry(0.54, 0.055, 0.2);
  visor.translate(0, -0.2, -0.27);
  return mergeParts([crown, visor]);
}

function plumeGeometry() {
  // Low-poly feather plume made from overlapping tapered lobes. It keeps the
  // performer silhouette readable without the old pointed witch-hat look.
  const parts: THREE.BufferGeometry[] = [];
  const lobes = [
    [0.0, -0.22, 0.2, 0.28],
    [-0.07, 0.0, 0.18, 0.3],
    [0.07, 0.18, 0.16, 0.27],
    [-0.04, 0.35, 0.13, 0.23],
  ] as const;
  for (const [x, y, r, sy] of lobes) {
    const g = new THREE.SphereGeometry(r, 8, 6);
    g.scale(0.72, sy / r, 0.72);
    g.translate(x, y, 0);
    parts.push(g);
  }
  return mergeParts(parts);
}

function instrumentGeometry(
  kind: InstrumentKind,
  sectionName = "",
  tubaModel: TubaModel = "sousaphone",
) {
  const T = (x: number, y: number, z: number) =>
    new THREE.Matrix4().makeTranslation(x, y, z);
  const RX = (r: number) => new THREE.Matrix4().makeRotationX(r);
  const RY = (r: number) => new THREE.Matrix4().makeRotationY(r);
  const RZ = (r: number) => new THREE.Matrix4().makeRotationZ(r);
  const M = (...mats: THREE.Matrix4[]) =>
    mats.reduce((a, b) => a.multiply(b), new THREE.Matrix4());

  switch (kind) {
    case "flute":
      return mergeParts([
        transformed(
          new THREE.CylinderGeometry(0.04, 0.04, 1.75, 8),
          T(-0.18, 0.6, 0.35),
        ),
        transformed(
          new THREE.CylinderGeometry(0.035, 0.035, 0.12, 8),
          T(-0.2, 0, 0.37),
        ),
        transformed(
          new THREE.CylinderGeometry(0.042, 0.042, 0.04, 8),
          T(-0.18, -0.24, 0.35),
        ),
      ]);
    case "clarinet":
      return mergeParts([
        transformed(
          new THREE.CylinderGeometry(0.04, 0.06, 1.25, 8),
          T(0, -0.1, 0.08),
        ),
        transformed(new THREE.ConeGeometry(0.11, 0.28, 10), T(0, -0.6, 0.08)),
        transformed(
          new THREE.CylinderGeometry(0.03, 0.045, 0.22, 8),
          T(0, 0.62, 0.08),
        ),
      ]);
    case "sax":
      return mergeParts([
        transformed(
          new THREE.CylinderGeometry(0.06, 0.09, 0.8, 9),
          T(0, 0.1, -0.05),
        ),
        transformed(
          new THREE.TorusGeometry(0.12, 0.09, 7, 12, Math.PI * 0.9),
          M(T(0, -0.28, -0.17), RX(2.9), RY((Math.PI * 3) / 2)),
        ),
        transformed(
          new THREE.ConeGeometry(0.13, 0.35, 10),
          M(T(0, -0.18, -0.31), RX(-0.33), RZ(Math.PI)),
        ),
        transformed(
          new THREE.CylinderGeometry(0.055, 0.035, 0.36, 7),
          M(T(-0, 0.6, 0), RX(-2.8)),
        ),
        transformed(
          new THREE.CylinderGeometry(0.09, 0.09, 0.3, 9),
          M(T(0, -0.18, -0.31), RX(-0.25)),
        ),
      ]);
    case "trumpet":
      // Smallest bell-front brass. Geometry is built along local Y and rotated
      // into playing position later.
      return mergeParts([
        transformed(
          new THREE.CylinderGeometry(0.02, 0.02, 0.9, 8),
          T(0, 0.05, -0.2),
        ),
        transformed(
          new THREE.CylinderGeometry(0.02, 0.02, 0.7, 8),
          T(-0.03, -0.05, -0.05),
        ),
        transformed(
          new THREE.CylinderGeometry(0.02, 0.025, 0.8, 8),
          T(-0.06, -0.1, -0.23),
        ),
        transformed(
          new THREE.CylinderGeometry(0.02, 0.05, 0.14, 8),
          T(-0.06, -0.55, -0.23),
        ),
        transformed(
          new THREE.CylinderGeometry(0.02, 0.02, 0.25, 8),
          M(T(-0.02, 0, -0.15), RX(Math.PI / 2)),
        ),
        transformed(
          new THREE.CylinderGeometry(0.02, 0.02, 0.25, 8),
          M(T(-0.02, 0.05, -0.15), RX(Math.PI / 2)),
        ),
        transformed(
          new THREE.CylinderGeometry(0.02, 0.02, 0.25, 8),
          M(T(-0.02, -0.05, -0.15), RX(Math.PI / 2)),
        ),
        transformed(
          new THREE.CylinderGeometry(0.015, 0.015, 0.14, 8),
          M(T(-0.01, -0.32, -0.14), RX(Math.PI / 2), RZ(0.2)),
        ),
        transformed(
          new THREE.ConeGeometry(0.15, 0.2, 14, 1, true),
          T(-0.06, -0.65, -0.23),
        ),
        transformed(
          new THREE.ConeGeometry(0.06, 0.1, 14, 1, true),
          M(T(0, 0.46, -0.2), RZ(Math.PI)),
        ),
        transformed(
          new THREE.TorusGeometry(0.076, 0.02, 6, 12, Math.PI),
          M(T(-0.015, -0.4, -0.125), RY(1.4), RZ(Math.PI)),
        ),
        transformed(
          new THREE.TorusGeometry(0.093, 0.02, 6, 12, Math.PI),
          M(T(-0.045, 0.3, -0.14), RY(Math.PI - 1.4)),
        ),
      ]);
    case "mello":
      // Mellophone: trumpet-like body with a noticeably larger, wider bell.
      return mergeParts([
        transformed(
          new THREE.CylinderGeometry(0.02, 0.02, 0.55, 8),
          T(0, 0.18, -0.2),
        ),
        transformed(
          new THREE.CylinderGeometry(0.03, 0.02, 0.55, 8),
          T(-0.02, -0.075, 0.08),
        ),
        transformed(
          new THREE.CylinderGeometry(0.03, 0.03, 0.75, 8),
          T(-0.06, -0.175, -0.23),
        ),
        transformed(
          new THREE.CylinderGeometry(0.03, 0.102, 0.54, 8),
          T(-0.06, -0.3, -0.23),
        ),
        transformed(
          new THREE.CylinderGeometry(0.02, 0.02, 0.35, 8),
          T(0, 0.08, -0.04),
        ),
        transformed(
          new THREE.CylinderGeometry(0.02, 0.02, 0.6, 8),
          T(-0.02, -0.05, -0.14),
        ),
        transformed(
          new THREE.CylinderGeometry(0.02, 0.02, 0.22, 8),
          M(T(-0.02, 0, -0.18), RX(Math.PI / 2)),
        ),
        transformed(
          new THREE.CylinderGeometry(0.02, 0.02, 0.22, 8),
          M(T(-0.02, 0.05, -0.18), RX(Math.PI / 2)),
        ),
        transformed(
          new THREE.CylinderGeometry(0.02, 0.02, 0.22, 8),
          M(T(-0.02, -0.05, -0.18), RX(Math.PI / 2)),
        ),
        transformed(
          new THREE.ConeGeometry(0.28, 0.2, 14, 1, true),
          T(-0.06, -0.6, -0.23),
        ),
        transformed(
          new THREE.ConeGeometry(0.06, 0.1, 14, 1, true),
          M(T(0, 0.46, -0.2), RZ(Math.PI)),
        ),
        transformed(
          new THREE.TorusGeometry(0.08, 0.02, 6, 12, Math.PI),
          M(T(0, -0.09, -0.12), RY(Math.PI / 2), RZ(Math.PI)),
        ),
        transformed(
          new THREE.TorusGeometry(0.05, 0.02, 6, 12, Math.PI),
          M(T(-0.01, 0.25, -0.09), RY(Math.PI / 2 + 0.36)),
        ),
        transformed(
          new THREE.TorusGeometry(0.11, 0.02, 6, 12, Math.PI),
          M(T(-0.02, -0.35, -0.03), RY(Math.PI / 2), RZ(Math.PI)),
        ),
        transformed(
          new THREE.TorusGeometry(0.155, 0.03, 6, 12, Math.PI),
          M(T(-0.04, 0.2, -0.075), RY(Math.PI - 1.4)),
        ),
      ]);
    case "trombone":
      // Tenor/bass trombone: long straight slide with a bell-front flare.
      // Built along local Y like the other brass and rotated into playing
      // position later. The offset parallel tubes make the slide readable.
      return mergeParts([
        transformed(
          new THREE.CylinderGeometry(0.028, 0.028, 1.4, 8),
          T(-0.3, -0.3, 0.1),
        ),
        transformed(
          new THREE.CylinderGeometry(0.028, 0.028, 1.4, 8),
          T(-0.45, -0.3, 0.4),
        ),
        transformed(
          new THREE.CylinderGeometry(0.065, 0.028, 0.72, 8),
          T(-0.45, 0.07, 0.4),
        ),
        transformed(
          new THREE.CylinderGeometry(0.028, 0.028, 1.4, 8),
          T(-0.3, 0.9, 0.1),
        ),
        transformed(
          new THREE.CylinderGeometry(0.028, 0.028, 2.1, 8),
          T(0, 0.55, 0.25),
        ),
        transformed(
          new THREE.CylinderGeometry(0.028, 0.028, 0.3, 8),
          M(T(-0.15, 0.2, 0.175), RX(Math.PI / 2), RZ((Math.PI * 2) / 3)),
        ),
        transformed(
          new THREE.CylinderGeometry(0.028, 0.028, 0.3, 8),
          M(T(-0.15, -0.25, 0.175), RX(Math.PI / 2), RZ((Math.PI * 2) / 3)),
        ),
        transformed(
          new THREE.CylinderGeometry(0.028, 0.028, 0.3, 8),
          M(T(-0.375, -0.4, 0.25), RX(Math.PI / 2), RZ(Math.PI / 6)),
        ),
        transformed(
          new THREE.CylinderGeometry(0.028, 0.028, 0.3, 8),
          M(T(-0.375, -0.9, 0.25), RX(Math.PI / 2), RZ(Math.PI / 6)),
        ),
        transformed(
          new THREE.ConeGeometry(0.24, 0.22, 14, 1, true),
          M(T(-0.45, 0.48, 0.4), RX(Math.PI)),
        ),
        transformed(
          new THREE.ConeGeometry(0.06, 0.1, 14, 1, true),
          T(0, -0.5, 0.25),
        ),
        transformed(
          new THREE.TorusGeometry(0.17, 0.024, 7, 14, Math.PI),
          M(T(-0.375, -1, 0.25), RY(1.11), RZ(Math.PI)),
        ),
        transformed(
          new THREE.TorusGeometry(0.17, 0.024, 7, 14, Math.PI),
          M(T(-0.15, 1.6, 0.175), RY(2.7)),
        ),
      ]);
    case "baritone":
      // Marching baritone/euphonium: essentially a chunky, deep-bodied trumpet
      // held bell-front, with larger tubing and bell than a mellophone.
      return mergeParts([
        transformed(
          new THREE.CylinderGeometry(0.02, 0.02, 0.75, 8),
          T(0, 0.08, -0.2),
        ),
        transformed(
          new THREE.CylinderGeometry(0.045, 0.03, 0.55, 8),
          T(-0.02, -0.105, 0.14),
        ),
        transformed(
          new THREE.CylinderGeometry(0.045, 0.045, 0.75, 8),
          T(-0.09, -0.205, -0.23),
        ),
        transformed(
          new THREE.CylinderGeometry(0.045, 0.12, 0.6, 8),
          T(-0.09, -0.345, -0.23),
        ),
        transformed(
          new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8),
          T(0, -0.04, 0.04),
        ),
        transformed(
          new THREE.CylinderGeometry(0.02, 0.02, 0.6, 8),
          T(-0.02, -0.08, -0.12),
        ),
        transformed(
          new THREE.CylinderGeometry(0.02, 0.02, 0.22, 8),
          M(T(-0.02, -0.03, -0.18), RX(Math.PI / 2)),
        ),
        transformed(
          new THREE.CylinderGeometry(0.02, 0.02, 0.22, 8),
          M(T(-0.02, 0.02, -0.18), RX(Math.PI / 2)),
        ),
        transformed(
          new THREE.CylinderGeometry(0.02, 0.02, 0.22, 8),
          M(T(-0.02, -0.08, -0.18), RX(Math.PI / 2)),
        ),
        transformed(
          new THREE.ConeGeometry(0.28, 0.4, 20, 1, true),
          T(-0.09, -0.68, -0.23),
        ),
        transformed(
          new THREE.ConeGeometry(0.06, 0.1, 14, 1, true),
          M(T(0, 0.46, -0.2), RZ(Math.PI)),
        ),
        transformed(
          new THREE.TorusGeometry(0.12, 0.02, 6, 12, Math.PI),
          M(T(0, -0.29, -0.08), RY(Math.PI / 2), RZ(Math.PI)),
        ),
        transformed(
          new THREE.TorusGeometry(0.08, 0.02, 6, 12, Math.PI),
          M(T(-0.01, 0.2, -0.042), RY(Math.PI / 2 + 0.36)),
        ),
        transformed(
          new THREE.TorusGeometry(0.13, 0.03, 6, 12, Math.PI),
          M(T(-0.02, -0.38, 0.01), RY(Math.PI / 2), RZ(Math.PI)),
        ),
        transformed(
          new THREE.TorusGeometry(0.188, 0.045, 6, 12, Math.PI),
          M(T(-0.054, 0.17, -0.047), RY(Math.PI - 1.4)),
        ),
      ]);
    case "tuba": {
      if (tubaModel === "contrabassBugle") {
        // Compact marching contrabass bugle: a large front-facing wrap of
        // tubing with a tall leadpipe and forward bell. Keep it low-poly
        // because this geometry is instanced for every tuba player.
        const bodyCurve = new THREE.CatmullRomCurve3(
          [
            new THREE.Vector3(-0.28, 0.5, -0.34),
            new THREE.Vector3(-0.58, 0.18, -0.48),
            new THREE.Vector3(-0.48, -0.38, -0.5),
            new THREE.Vector3(0.28, -0.42, -0.5),
            new THREE.Vector3(0.55, -0.08, -0.42),
            new THREE.Vector3(0.42, 0.35, -0.34),
            new THREE.Vector3(0.08, 0.5, -0.32),
          ],
          false,
          "catmullrom",
          0.5,
        );
        const body = new THREE.TubeGeometry(bodyCurve, 28, 0.075, 8, false);

        const leadpipeCurve = new THREE.CatmullRomCurve3(
          [
            new THREE.Vector3(0.08, 0.48, -0.32),
            new THREE.Vector3(0.18, 0.72, -0.34),
            new THREE.Vector3(0.34, 0.92, -0.43),
            new THREE.Vector3(0.38, 1.15, -0.58),
            new THREE.Vector3(0.38, 1.28, -0.72),
          ],
          false,
          "catmullrom",
          0.5,
        );
        const leadpipe = new THREE.TubeGeometry(
          leadpipeCurve,
          18,
          0.08,
          8,
          false,
        );

        const bell = transformed(
          new THREE.CylinderGeometry(0.48, 0.12, 0.68, 18, 1, true),
          M(T(0.38, 1.28, -1.0), RX(-Math.PI / 2)),
        );
        const bellRim = transformed(
          new THREE.TorusGeometry(0.48, 0.032, 8, 22),
          T(0.38, 1.28, -1.34),
        );

        return mergeParts([
          body,
          leadpipe,
          bell,
          bellRim,
          transformed(
            new THREE.BoxGeometry(0.28, 0.3, 0.2),
            T(-0.02, 0.18, -0.42),
          ),
          transformed(
            new THREE.CylinderGeometry(0.022, 0.022, 0.24, 7),
            T(-0.1, 0.34, -0.43),
          ),
          transformed(
            new THREE.CylinderGeometry(0.022, 0.022, 0.24, 7),
            T(-0.02, 0.34, -0.43),
          ),
          transformed(
            new THREE.CylinderGeometry(0.022, 0.022, 0.24, 7),
            T(0.06, 0.34, -0.43),
          ),
          transformed(
            new THREE.TorusGeometry(0.16, 0.028, 7, 14, Math.PI * 1.35),
            M(T(-0.02, 0.34, -0.4), RZ(0.35)),
          ),
        ]);
      }

      // Sousaphone body shaped like a diagonal sash around the performer:
      // high on the left shoulder, low on the right hip, with the tube
      // continuing behind the torso to complete the wrap. Local -Z is front.
      const sashCurve = new THREE.CatmullRomCurve3(
        [
          new THREE.Vector3(-0.46, 0.52, -0.04), // left shoulder
          new THREE.Vector3(-0.36, 0.26, -0.32), // front-left chest
          new THREE.Vector3(0.18, -0.2, -0.4), // front waist
          new THREE.Vector3(0.48, -0.48, -0.12), // right hip
          new THREE.Vector3(0.4, -0.36, 0.3), // behind right hip
          new THREE.Vector3(-0.1, 0.02, 0.43), // center back
          new THREE.Vector3(-0.48, 0.42, 0.24), // behind left shoulder
          new THREE.Vector3(-0.46, 0.52, -0.04),
        ],
        false,
        "catmullrom",
        0.45,
      );
      const sash = new THREE.TubeGeometry(sashCurve, 36, 0.065, 8, false);

      // Curved sousaphone neck: rises from the left shoulder and bends
      // forward so the bell faces straight toward the performer's front.
      // Local -Z is front in the performer coordinate system.
      const bellNeckCurve = new THREE.CatmullRomCurve3(
        [
          new THREE.Vector3(-0.47, 0.56, 0.02),
          new THREE.Vector3(-0.5, 0.78, 0.0),
          new THREE.Vector3(-0.51, 0.98, -0.1),
          new THREE.Vector3(-0.5, 1.12, -0.25),
          new THREE.Vector3(-0.49, 1.17, -0.38),
        ],
        false,
        "catmullrom",
        0.5,
      );
      const bellNeck = new THREE.TubeGeometry(
        bellNeckCurve,
        20,
        0.074,
        9,
        false,
      );

      // The bell is a flared truncated cone. CylinderGeometry lets us keep a
      // real throat instead of ending in a point. Rotating -90 degrees around
      // X points the large mouth toward local -Z (the front of the marcher).
      const bell = transformed(
        new THREE.CylinderGeometry(0.44, 0.115, 0.62, 18, 1, true),
        M(T(-0.49, 1.17, -0.69), RX(-Math.PI / 2)),
      );
      const bellRim = transformed(
        new THREE.TorusGeometry(0.44, 0.03, 8, 22),
        T(-0.49, 1.17, -1.0),
      );

      return mergeParts([
        sash,
        bellNeck,
        bell,
        bellRim,
        // Compact valve block and leadpipe in front of the chest.
        transformed(
          new THREE.BoxGeometry(0.25, 0.28, 0.19),
          T(0.05, 0.05, -0.38),
        ),
        transformed(
          new THREE.CylinderGeometry(0.02, 0.02, 0.22, 7),
          T(-0.02, 0.2, -0.39),
        ),
        transformed(
          new THREE.CylinderGeometry(0.02, 0.02, 0.22, 7),
          T(0.05, 0.2, -0.39),
        ),
        transformed(
          new THREE.CylinderGeometry(0.02, 0.02, 0.22, 7),
          T(0.12, 0.2, -0.39),
        ),
        transformed(
          new THREE.TorusGeometry(0.18, 0.03, 7, 14, Math.PI * 1.35),
          M(T(-0.13, 0.23, -0.36), RZ(0.42)),
        ),
      ]);
    }
    case "snare":
      return mergeParts([
        transformed(
          new THREE.CylinderGeometry(0.48, 0.48, 0.45, 14),
          T(0, -0.2, -0.2),
        ),
        transformed(
          new THREE.TorusGeometry(0.49, 0.035, 6, 16),
          M(T(0, 0.02, -0.2), RX(Math.PI / 2)),
        ),
        transformed(
          new THREE.TorusGeometry(0.49, 0.035, 6, 16),
          M(T(0, -0.42, -0.2), RX(Math.PI / 2)),
        ),
      ]);
    case "tenors": {
      const parts: THREE.BufferGeometry[] = [];
      const name = sectionName.trim().toLowerCase();
      const drums = [
        [-1.02, -0.35, -0.05, 0.48],
        [-0.37, -0.35, -0.67, 0.411],
        [0.39, -0.35, -0.62, 0.343],
        [0.92, -0.35, 0.0, 0.446],
      ];
      if (/quint|quints/.test(name)) {
        drums.push([0.0, -0.35, 0, 0.206]);
      }
      if (/tenor|tenors|sextet|sextets/.test(name)) {
        drums.push([0.25, -0.35, 0.02, 0.206], [-0.24, -0.35, 0.04, 0.274]);
      }
      for (const [x, y, z, r] of drums)
        parts.push(
          transformed(new THREE.CylinderGeometry(r, r, 0.45, 12), T(x, y, z)),
        );
      return mergeParts(parts);
    }
    case "bass":
      return mergeParts([
        transformed(
          new THREE.CylinderGeometry(0.72, 0.72, 0.7, 16),
          RZ(Math.PI / 2),
        ),
        transformed(
          new THREE.TorusGeometry(0.72, 0.035, 6, 18),
          M(T(0.2, 0, 0), new THREE.Matrix4().makeRotationY(Math.PI / 2)),
        ),
        transformed(
          new THREE.TorusGeometry(0.72, 0.035, 6, 18),
          M(T(-0.2, 0, 0), new THREE.Matrix4().makeRotationY(Math.PI / 2)),
        ),
        transformed(
          new THREE.TorusGeometry(0.72, 0.035, 6, 18),
          M(T(0.34, 0, 0), new THREE.Matrix4().makeRotationY(Math.PI / 2)),
        ),
        transformed(
          new THREE.TorusGeometry(0.72, 0.035, 6, 18),
          M(T(-0.34, 0, 0), new THREE.Matrix4().makeRotationY(Math.PI / 2)),
        ),
      ]);
    case "cymbals":
      return mergeParts([
        transformed(
          new THREE.CylinderGeometry(0.5, 0.62, 0.08, 24),
          M(T(-0.34, 0, 0), RZ(Math.PI / 2)),
        ),
        transformed(
          new THREE.CylinderGeometry(0.62, 0.5, 0.08, 24),
          M(T(0.34, 0, 0), RZ(Math.PI / 2)),
        ),
        transformed(
          new THREE.CylinderGeometry(0.12, 0.16, 0.14, 12),
          M(T(-0.43, 0, 0), RZ(Math.PI / 2)),
        ),
        transformed(
          new THREE.CylinderGeometry(0.12, 0.16, 0.14, 12),
          M(T(0.43, 0, 0), RZ(Math.PI / 2)),
        ),
      ]);
    case "toms":
      return mergeParts([
        transformed(
          new THREE.CylinderGeometry(0.45, 0.45, 0.45, 14),
          T(0, -0.3, -0.2),
        ),
        transformed(
          new THREE.TorusGeometry(0.46, 0.035, 6, 16),
          M(T(0, -0.08, -0.2), RX(Math.PI / 2)),
        ),
      ]);
    case "flag":
      // Guard flag: long pole with a simple rectangular silk attached near the top.
      return mergeParts([
        transformed(
          new THREE.CylinderGeometry(0.035, 0.035, 4.9, 8),
          new THREE.Matrix4(),
        ),
        transformed(new THREE.BoxGeometry(1.65, 1.15, 0.035), T(0.82, 1.45, 0)),
        transformed(new THREE.BoxGeometry(0.18, 0.09, 0.09), T(0, -2.42, 0)),
      ]);
    case "saber":
      // Low-poly guard sabre: narrow blade, crossguard and grip.
      return mergeParts([
        transformed(new THREE.BoxGeometry(0.055, 2.5, 0.035), T(0, 0.5, 0)),
        transformed(new THREE.BoxGeometry(0.55, 0.07, 0.1), T(0, -0.8, 0)),
        transformed(
          new THREE.CylinderGeometry(0.075, 0.075, 0.5, 8),
          T(0, -1.08, 0),
        ),
      ]);
    case "rifle":
      // Stylized color-guard rifle: stock/body, barrel, and trigger guard.
      return mergeParts([
        transformed(new THREE.BoxGeometry(0.2, 1.55, 0.13), T(0, 0.12, 0)),
        transformed(
          new THREE.BoxGeometry(0.34, 0.58, 0.18),
          M(T(-0.08, -0.76, 0), RZ(-0.2)),
        ),
        transformed(
          new THREE.CylinderGeometry(0.045, 0.045, 0.72, 7),
          T(0, 1.23, 0),
        ),
        transformed(
          new THREE.TorusGeometry(0.12, 0.025, 6, 10, Math.PI * 1.25),
          M(T(0.12, -0.1, 0), RZ(Math.PI / 2)),
        ),
      ]);
    default:
      return new THREE.BoxGeometry(0.01, 0.01, 0.01);
  }
}

function isGuardSection(section: string | null | undefined) {
  const name = (section ?? "").trim().toLowerCase();
  return /(^|\b)(guard|color guard|colour guard|colorguard|flag|flags|rifle|rifles|saber|sabre|dancer|dancers)(\b|$)/.test(
    name,
  );
}

function instrumentForSection(
  section: string | null | undefined,
): InstrumentKind {
  const name = (section ?? "").trim().toLowerCase();
  // Guard equipment follows the OpenMarch section name. Dancers intentionally
  // have no equipment; generic Color Guard is treated as the flag line.
  if (/dancer|dance/.test(name)) return "none";
  if (/rifle/.test(name)) return "rifle";
  if (/saber|sabre/.test(name)) return "saber";
  if (/flag|color guard|colour guard|colorguard|(^|\b)guard(\b|$)/.test(name))
    return "flag";
  if (/flute|piccolo/.test(name)) return "flute";
  if (/clarinet/.test(name)) return "clarinet";
  if (/sax|saxophone/.test(name)) return "sax";
  if (/trumpet|cornet/.test(name)) return "trumpet";
  if (/mello|mellophone|french horn|horn/.test(name)) return "mello";
  if (/trombone|bass trombone|tenor trombone|(^|\b)tbn(\b|$)/.test(name))
    return "trombone";
  if (/baritone|euphonium/.test(name)) return "baritone";
  if (/tuba|sousaphone/.test(name)) return "tuba";
  if (/(^|\b)(snare|snares)(\b|$)/.test(name)) return "snare";
  if (/tenor|tenors|quad|quads|quint|quints|sextet|sextets/.test(name))
    return "tenors";
  if (/bass drum|bass drums/.test(name)) return "bass";
  if (/cymbal|cymbals/.test(name)) return "cymbals";
  if (/tom|toms|flub|flub drum|flub drums/.test(name)) return "toms";
  return "none";
}

function isBatterySection(section: string | null | undefined) {
  const name = (section ?? "").trim().toLowerCase();
  return /(^|\b)(snare|snares|tenor|tenors|quad|quads|quint|quints|sextet|sextets|bass drum|bass drums|cymbal|cymbals|tom|toms|flub|flub drum|flub drums|battery|drumline|drum line)(\b|$)/.test(
    name,
  );
}

function wrapRadians(angle: number) {
  return (
    THREE.MathUtils.euclideanModulo(angle + Math.PI, Math.PI * 2) - Math.PI
  );
}

function shortestAngleDegrees(a: number, b: number, t: number) {
  const delta = ((b - a + 540) % 360) - 180;
  return a + delta * t;
}

type PreparedPosition = {
  x: number;
  z: number;
  rotation: number;
  visible: boolean;
  color: string;
};

function multiplyParts(
  target: THREE.Matrix4,
  root: THREE.Matrix4,
  ...parts: THREE.Matrix4[]
) {
  target.copy(root);
  for (const part of parts) target.multiply(part);
  return target;
}

export default function Marchers({
  drill,
  labels,
  pageTimes = [],
  playheadRef,
  forceMarcherRedraw,
  tubaModel = "sousaphone",
}: {
  drill: Drill;
  labels: boolean;
  pageTimes?: number[];
  playheadRef: MutableRefObject<number>;
  forceMarcherRedraw?: boolean;
  tubaModel?: TubaModel;
}) {
  const torsoRef = useRef<THREE.InstancedMesh>(null);
  const headRef = useRef<THREE.InstancedMesh>(null);
  const shakoRef = useRef<THREE.InstancedMesh>(null);
  const plumeRef = useRef<THREE.InstancedMesh>(null);
  const armsRef = useRef<THREE.InstancedMesh>(null);
  const forearmsRef = useRef<THREE.InstancedMesh>(null);
  const handsRef = useRef<THREE.InstancedMesh>(null);
  const legsRef = useRef<THREE.InstancedMesh>(null);
  const feetRef = useRef<THREE.InstancedMesh>(null);
  const fluteRef = useRef<THREE.InstancedMesh>(null);
  const clarinetRef = useRef<THREE.InstancedMesh>(null);
  const saxRef = useRef<THREE.InstancedMesh>(null);
  const trumpetRef = useRef<THREE.InstancedMesh>(null);
  const melloRef = useRef<THREE.InstancedMesh>(null);
  const baritoneRef = useRef<THREE.InstancedMesh>(null);
  const tromboneRef = useRef<THREE.InstancedMesh>(null);
  const tubaRef = useRef<THREE.InstancedMesh>(null);
  const snareRef = useRef<THREE.InstancedMesh>(null);
  const tenorsRef = useRef<THREE.InstancedMesh>(null);
  const bassDrumRef = useRef<THREE.InstancedMesh>(null);
  const cymbalsRef = useRef<THREE.InstancedMesh>(null);
  const tomsRef = useRef<THREE.InstancedMesh>(null);
  const flagRef = useRef<THREE.InstancedMesh>(null);
  const rifleRef = useRef<THREE.InstancedMesh>(null);
  const saberRef = useRef<THREE.InstancedMesh>(null);
  const labelRefs = useRef(new Map<number, THREE.Group>());
  const lastColors = useRef<string[]>([]);
  const lastRenderedTimeRef = useRef(Number.NaN);

  const prepared = useMemo(() => {
    if (drill.preparedPositions) return drill.preparedPositions;
    const appearance = new Map(drill.appearances.map((a) => [a.section, a]));
    const marcherIndex = new Map(drill.marchers.map((m, i) => [m.id, i]));
    const pageIndex = new Map(drill.pages.map((p, i) => [p.id, i]));
    const table: Array<Array<PreparedPosition | undefined>> = drill.pages.map(
      () => new Array(drill.marchers.length),
    );

    for (const p of drill.positions) {
      const mi = marcherIndex.get(p.marcherId);
      const pi = pageIndex.get(p.pageId);
      if (mi === undefined || pi === undefined) continue;
      const m = drill.marchers[mi];
      const converted = positionToField(p, drill);
      table[pi][mi] = {
        x: converted.x,
        z: converted.z,
        rotation: p.rotation || 0,
        visible: sqliteBool(p.visible, true),
        color: parseColor(
          p.fillColor ?? appearance.get(m.section)?.fillColor,
          "#ff3333",
        ),
      };
    }
    return table;
  }, [drill]);

  // A page's start beat in OpenMarch marks the beginning of the move INTO
  // that page. That means the written counts for Set i -> Set i+1 are not
  // pages[i+1] - pages[i]. They are the interval beginning at page i+1 and
  // ending at page i+2. This matters most at the beginning of a show where
  // Set 0 commonly uses a zero-duration sentinel beat and Set 1 starts on beat
  // position 1. Treating that sentinel interval as the move made the first
  // formation use a 1-count stride even when it was really a 16-count move.
  const moveCountsByPage = useMemo(() => {
    const counts = new Array(drill.pages.length).fill(1);
    for (let pageIndex = 0; pageIndex < drill.pages.length - 1; pageIndex++) {
      const moveStartPage = drill.pages[pageIndex + 1];
      const followingPage = drill.pages[pageIndex + 2];

      if (followingPage) {
        counts[pageIndex] = Math.max(
          1,
          followingPage.startBeatIndex - moveStartPage.startBeatIndex,
        );
      } else {
        // OpenMarch stores the final page's written count length separately
        // because there is no following page boundary. Use it directly so the
        // last move gets the same stride size and foot cadence as OpenMarch.
        const previousPage = drill.pages[pageIndex];
        counts[pageIndex] =
          drill.lastPageCounts > 0
            ? drill.lastPageCounts
            : Math.max(
                1,
                moveStartPage.startBeatIndex - previousPage.startBeatIndex,
              );
      }
    }
    return counts;
  }, [drill.pages]);

  const showDomLabels =
    labels && drill.marchers.length <= LABEL_PERFORMANCE_LIMIT;
  const root = useMemo(() => new THREE.Matrix4(), []);
  const lowerRoot = useMemo(() => new THREE.Matrix4(), []);
  const result = useMemo(() => new THREE.Matrix4(), []);
  const t1 = useMemo(() => new THREE.Matrix4(), []);
  const t2 = useMemo(() => new THREE.Matrix4(), []);
  const t3 = useMemo(() => new THREE.Matrix4(), []);
  const t4 = useMemo(() => new THREE.Matrix4(), []);
  const t5 = useMemo(() => new THREE.Matrix4(), []);
  const t6 = useMemo(() => new THREE.Matrix4(), []);
  const position = useMemo(() => new THREE.Vector3(), []);
  const quaternion = useMemo(() => new THREE.Quaternion(), []);
  const scale = useMemo(() => new THREE.Vector3(1.55, 1.55, 1.55), []);
  const axisY = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const limbStart = useMemo(() => new THREE.Vector3(), []);
  const limbEnd = useMemo(() => new THREE.Vector3(), []);
  const limbMid = useMemo(() => new THREE.Vector3(), []);
  const limbDir = useMemo(() => new THREE.Vector3(), []);
  const limbQuat = useMemo(() => new THREE.Quaternion(), []);
  const limbScale = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const limbLocal = useMemo(() => new THREE.Matrix4(), []);
  const hiddenMatrix = useMemo(
    () => new THREE.Matrix4().makeScale(0, 0, 0),
    [],
  );
  const colorScratch = useMemo(() => new THREE.Color(), []);
  const shakoMeshGeometry = useMemo(() => shakoGeometry(), []);
  const plumeMeshGeometry = useMemo(() => plumeGeometry(), []);
  const fluteGeometry = useMemo(() => instrumentGeometry("flute"), []);
  const clarinetGeometry = useMemo(() => instrumentGeometry("clarinet"), []);
  const saxGeometry = useMemo(() => instrumentGeometry("sax"), []);
  const trumpetGeometry = useMemo(() => instrumentGeometry("trumpet"), []);
  const melloGeometry = useMemo(() => instrumentGeometry("mello"), []);
  const baritoneGeometry = useMemo(() => instrumentGeometry("baritone"), []);
  const tromboneGeometry = useMemo(() => instrumentGeometry("trombone"), []);
  const tubaGeometry = useMemo(
    () => instrumentGeometry("tuba", "", tubaModel),
    [tubaModel],
  );
  const snareGeometry = useMemo(() => instrumentGeometry("snare"), []);
  const tenorsGeometry = useMemo(
    () =>
      instrumentGeometry(
        "tenors",
        drill.marchers.find(
          (marcher) => instrumentForSection(marcher.section) === "tenors",
        )?.section,
      ),
    [drill.marchers],
  );
  const bassGeometry = useMemo(() => instrumentGeometry("bass"), []);
  const cymbalsGeometry = useMemo(() => instrumentGeometry("cymbals"), []);
  const tomsGeometry = useMemo(() => instrumentGeometry("toms"), []);
  const flagGeometry = useMemo(() => instrumentGeometry("flag"), []);
  const rifleGeometry = useMemo(() => instrumentGeometry("rifle"), []);
  const saberGeometry = useMemo(() => instrumentGeometry("saber"), []);
  const bassScaleById = useMemo(() => {
    const basses = drill.marchers
      .filter((m) => instrumentForSection(m.section) === "bass")
      // OpenMarch's drill order is the most reliable Bass 1 -> Bass N ordering.
      // Fall back to the number in the marcher name/prefix, then ID.
      .sort((a, b) => {
        const numberFor = (m: typeof a) => {
          const text = `${m.name ?? ""} ${m.drillPrefix ?? ""}`;
          const match = text.match(/(\d+)\s*$/);
          return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
        };
        return (
          a.drillOrder - b.drillOrder ||
          numberFor(a) - numberFor(b) ||
          a.id - b.id
        );
      });
    const scaleById = new Map<number, number>();
    basses.forEach((m, index) => {
      const t = basses.length <= 1 ? 0.5 : index / (basses.length - 1);
      // Bass 1 is visibly smallest; every drum grows progressively larger.
      scaleById.set(m.id, THREE.MathUtils.lerp(0.68, 1.2, t));
    });
    return scaleById;
  }, [drill.marchers]);

  // Reused limb builder. Keeping this outside the per-marcher loop avoids
  // allocating functions/vectors for every performer on every animation frame.
  const setLimbMatrix = (
    mesh: THREE.InstancedMesh,
    index: number,
    parent: THREE.Matrix4,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    nominalLength: number,
  ) => {
    limbStart.set(ax, ay, az);
    limbEnd.set(bx, by, bz);
    limbMid.copy(limbStart).add(limbEnd).multiplyScalar(0.5);
    limbDir.copy(limbEnd).sub(limbStart);
    const len = Math.max(0.001, limbDir.length());
    limbDir.multiplyScalar(1 / len);
    limbQuat.setFromUnitVectors(axisY, limbDir);
    limbScale.set(1, len / nominalLength, 1);
    limbLocal.compose(limbMid, limbQuat, limbScale);
    result.multiplyMatrices(parent, limbLocal);
    mesh.setMatrixAt(index, result);
  };

  useFrame(() => {
    const torso = torsoRef.current;
    const head = headRef.current;
    const shako = shakoRef.current;
    const plume = plumeRef.current;
    const arms = armsRef.current;
    const forearms = forearmsRef.current;
    const hands = handsRef.current;
    const legs = legsRef.current;
    const feet = feetRef.current;
    const instrumentMeshes = {
      flute: fluteRef.current,
      clarinet: clarinetRef.current,
      sax: saxRef.current,
      trumpet: trumpetRef.current,
      mello: melloRef.current,
      baritone: baritoneRef.current,
      trombone: tromboneRef.current,
      tuba: tubaRef.current,
      snare: snareRef.current,
      tenors: tenorsRef.current,
      bass: bassDrumRef.current,
      cymbals: cymbalsRef.current,
      toms: tomsRef.current,
      flag: flagRef.current,
      rifle: rifleRef.current,
      saber: saberRef.current,
    };

    if (
      !torso ||
      !head ||
      !shako ||
      !plume ||
      !arms ||
      !forearms ||
      !hands ||
      !legs ||
      !feet ||
      Object.values(instrumentMeshes).some((mesh) => !mesh) ||
      drill.pages.length === 0
    ) {
      return;
    }

    const count = drill.marchers.length;
    torso.count = count;
    head.count = count;
    shako.count = count;
    plume.count = count;
    arms.count = count * 2;
    forearms.count = count * 2;
    hands.count = count * 2;
    legs.count = count * 2;
    feet.count = count * 2;
    for (const mesh of Object.values(instrumentMeshes)) {
      if (mesh) {
        mesh.count = count;
      }
    }

    const time = Math.max(0, playheadRef.current || 0);
    if (
      !forceMarcherRedraw &&
      Math.abs(time - lastRenderedTimeRef.current) < 0.000001
    )
      return;
    lastRenderedTimeRef.current = time;

    let pageIndex = 0;
    for (let i = 1; i < pageTimes.length; i++) {
      if (time >= pageTimes[i]) pageIndex = i;
      else break;
    }

    const nextPageIndex = Math.min(pageIndex + 1, drill.pages.length - 1);
    const hasNext = nextPageIndex !== pageIndex;
    const start = pageIndex === 0 ? 0 : (pageTimes[pageIndex] ?? 0);
    const end = hasNext ? (pageTimes[nextPageIndex] ?? start + 1) : start + 1;
    const moveT = hasNext
      ? THREE.MathUtils.clamp(
          (time - start) / Math.max(0.001, end - start),
          0,
          1,
        )
      : 0;

    // Drive the feet from the actual OpenMarch beat sequence. The beat's
    // written position determines the lead foot globally: odd written counts
    // (1, 3, 5, ...) are LEFT and even written counts (2, 4, 6, ...) are RIGHT.
    // This avoids re-phasing individual marchers at page boundaries and keeps
    // every performer on the same foot through the opening sets and beyond.
    const frameMoveCounts = moveCountsByPage[pageIndex] ?? 1;
    const moveStartBeatIndex = drill.pages[pageIndex + 1]?.startBeatIndex ?? 0;
    let countPosition = 0;
    if (hasNext && time > start) {
      let remaining = Math.max(0, time - start);
      for (let count = 0; count < frameMoveCounts; count++) {
        const beatIndex = moveStartBeatIndex + count;
        const beatDuration = Math.max(
          0.001,
          Number(drill.beats[beatIndex]?.duration) ||
            (end - start) / frameMoveCounts,
        );
        if (remaining >= beatDuration) {
          countPosition = count + 1;
          remaining -= beatDuration;
        } else {
          countPosition =
            count + THREE.MathUtils.clamp(remaining / beatDuration, 0, 1);
          break;
        }
      }
      countPosition = Math.min(frameMoveCounts, countPosition);
    }
    const currentCountIndex = Math.min(
      frameMoveCounts - 1,
      Math.max(0, Math.floor(Math.min(countPosition, frameMoveCounts - 1e-6))),
    );
    const countFraction = THREE.MathUtils.clamp(
      countPosition - Math.floor(countPosition),
      0,
      1,
    );
    const activeStepWave =
      hasNext && countPosition < frameMoveCounts
        ? Math.sin(Math.PI * countFraction)
        : 0;
    // Use the real beat position rather than resetting parity at each move.
    // OpenMarch's sentinel beat is position 0; the first playable beat is
    // position 1, so the show naturally steps off on the left foot.
    const activeBeatIndex = Math.min(
      drill.beats.length - 1,
      Math.max(0, moveStartBeatIndex + currentCountIndex),
    );
    const writtenBeatPosition = Number(drill.beats[activeBeatIndex]?.position);
    const writtenCountIsOdd = Number.isFinite(writtenBeatPosition)
      ? Math.abs(Math.trunc(writtenBeatPosition)) % 2 === 1
      : currentCountIndex % 2 === 0;
    const alternatingStepSign = writtenCountIsOdd ? 1 : -1;
    const countLockedSwing = activeStepWave * alternatingStepSign;

    // OpenMarch notes on page N describe the move INTO set N.
    // The playback pageIndex is the set we are moving FROM, so instructions
    // for the current move belong to pageIndex + 1, not pageIndex.
    // Rebuild state each frame to preserve correct seeking and rewinding.
    const instructionPageIndex = hasNext ? pageIndex + 1 : pageIndex;
    const instructionCount = hasNext ? currentCountIndex + 1 : 1;
    const activeInstructions = (drill.instructions ?? []).filter(
      (command) =>
        command.pageIndex < instructionPageIndex ||
        (command.pageIndex === instructionPageIndex &&
          command.count <= instructionCount),
    );
    const matchesTarget = (
      target: string,
      marcher: Drill["marchers"][number],
    ) => {
      const section = marcher.section.toLowerCase();
      const name = target.toLowerCase().trim();
      if (name === "all" || name === "everyone") return true;
      if (name === "guard" || name === "color guard" || name === "colorguard")
        return isGuardSection(marcher.section);
      if (name === "drumline" || name === "battery")
        return isBatterySection(marcher.section);
      if (name === "woodwinds")
        return /flute|piccolo|clarinet|sax|oboe|bassoon/.test(section);
      if (name === "brass")
        return /trumpet|mello|horn|baritone|euphonium|trombone|tuba|sousaphone/.test(
          section,
        );
      if (name === "tubas") return /tuba|sousaphone/.test(section);
      if (name === "baritones") return /baritone|euphonium/.test(section);
      if (name === section || name === section.replace(/s$/, "")) return true;
      const marcherLabel =
        `${marcher.drillPrefix}${marcher.drillOrder}`.toLowerCase();
      return name.split(/\s*,\s*/).some((part) => {
        const range = /^([a-z]+)(\d+)\s*-\s*(?:[a-z]+)?(\d+)$/.exec(part);
        if (range)
          return (
            marcher.drillPrefix.toLowerCase() === range[1] &&
            marcher.drillOrder >= Number(range[2]) &&
            marcher.drillOrder <= Number(range[3])
          );
        return (
          part === marcherLabel || part === (marcher.name ?? "").toLowerCase()
        );
      });
    };

    let colorsChanged = false;
    for (let i = 0; i < drill.marchers.length; i++) {
      const a = prepared[pageIndex]?.[i];
      if (!a || !a.visible) {
        torso.setMatrixAt(i, hiddenMatrix);
        head.setMatrixAt(i, hiddenMatrix);
        shako.setMatrixAt(i, hiddenMatrix);
        plume.setMatrixAt(i, hiddenMatrix);
        arms.setMatrixAt(i * 2, hiddenMatrix);
        arms.setMatrixAt(i * 2 + 1, hiddenMatrix);
        forearms.setMatrixAt(i * 2, hiddenMatrix);
        forearms.setMatrixAt(i * 2 + 1, hiddenMatrix);
        hands.setMatrixAt(i * 2, hiddenMatrix);
        hands.setMatrixAt(i * 2 + 1, hiddenMatrix);
        legs.setMatrixAt(i * 2, hiddenMatrix);
        legs.setMatrixAt(i * 2 + 1, hiddenMatrix);
        feet.setMatrixAt(i * 2, hiddenMatrix);
        feet.setMatrixAt(i * 2 + 1, hiddenMatrix);
        for (const mesh of Object.values(instrumentMeshes))
          mesh!.setMatrixAt(i, hiddenMatrix);
        const label = labelRefs.current.get(i);
        if (label) label.visible = false;
        continue;
      }

      const candidate = hasNext ? prepared[nextPageIndex]?.[i] : undefined;
      const b = candidate?.visible ? candidate : a;
      let x = THREE.MathUtils.lerp(a.x, b.x, moveT);
      let z = THREE.MathUtils.lerp(a.z, b.z, moveT);
      const rotation = shortestAngleDegrees(a.rotation, b.rotation, moveT);
      const dx = hasNext ? b.x - a.x : 0;
      const dz = hasNext ? b.z - a.z : 0;
      const movingDistance = Math.hypot(dx, dz);
      // A marcher on the initial dot is HOLDING, even when a later set has
      // a different position. Do not pre-turn their hips/feet toward the
      // upcoming pathway before the first count actually begins.
      const isMoving =
        hasNext &&
        movingDistance > 0.035 &&
        countPosition > 0.0001 &&
        countPosition < frameMoveCounts;

      const marcher = drill.marchers[i];
      const battery = isBatterySection(marcher?.section);
      const guard = isGuardSection(marcher?.section);
      const instrument = instrumentForSection(marcher?.section);
      // Resolve instruction state from drill time, never wall-clock time.
      // A command remains active until another command of its kind replaces it.
      let marchingMode: "fullTime" | "doubleTime" | "markTime" = "fullTime";
      let hasEquipment = true;
      let guardEquipment: "flag" | "rifle" | "saber" =
        instrument === "rifle" || instrument === "saber" ? instrument : "flag";
      let guardMotion: "none" | "spinning" | "tossing" = "none";
      let guardMotionStartPage = -1;
      let guardMotionStartCount = 1;
      let guardMotionDuration = 1;
      if (marcher) {
        for (const command of activeInstructions) {
          if (!matchesTarget(command.target, marcher)) continue;
          if (command.action === "marching")
            marchingMode = command.value as typeof marchingMode;
          if (guard && command.action === "equipment") {
            if (command.value === "none") hasEquipment = false;
            else if (command.value === "has") hasEquipment = true;
            else if (
              command.value === "flag" ||
              command.value === "rifle" ||
              command.value === "saber"
            ) {
              guardEquipment = command.value;
              hasEquipment = true;
            }
          }
          if (guard && command.action === "guardMotion") {
            guardMotion = command.value as "spinning" | "tossing";
            guardMotionStartPage = command.pageIndex;
            guardMotionStartCount = command.count;
            guardMotionDuration = Math.max(1, command.durationCounts ?? 1);
          }
        }
      }
      const resolvedMarchingMode: string = marchingMode;
      const markTime = resolvedMarchingMode === "markTime";
      // Mark Time animates feet in place; drill dot interpolation remains authoritative.
      const cadence = resolvedMarchingMode === "doubleTime" ? 2 : 1;
      // Use the beat clock for every gait, including marking time on a hold.
      const gaitMoving = isMoving || markTime;
      const gaitPhase = countFraction * cadence;
      const gaitWave = Math.sin(Math.PI * (gaitPhase - Math.floor(gaitPhase)));
      const gaitSign =
        alternatingStepSign * (Math.floor(gaitPhase) % 2 === 0 ? 1 : -1);
      const gaitSwing = gaitMoving ? gaitWave * gaitSign : 0;

      // OpenMarch movement is count-based. Work out the actual distance covered
      // by THIS marcher on every written count. Instead of scaling an arbitrary
      // 28-degree walk cycle, solve the leg angle from the requested step size:
      //   step distance ~= 2 * legLength * sin(legAngle)
      // This lets short-step marchers take visibly short steps and long-step
      // marchers take visibly larger ones, including in the opening sets.
      const moveCounts = moveCountsByPage[pageIndex] ?? 1;
      const feetPerCount = moveCounts > 0 ? movingDistance / moveCounts : 0;
      const halfStrideRatio = THREE.MathUtils.clamp(
        feetPerCount / Math.max(0.001, 2 * LEG_LENGTH),
        0,
        Math.sin(THREE.MathUtils.degToRad(68)),
      );
      // Preserve a visible step even for very short drill moves. The old
      // calculated angle could approach zero, making the lower body look frozen.
      const solvedLegAngle = gaitMoving
        ? markTime
          ? THREE.MathUtils.degToRad(24)
          : Math.max(
              THREE.MathUtils.degToRad(12),
              Math.asin(halfStrideRatio / cadence),
            )
        : 0;
      const swing = gaitSwing;
      const oppositeSwing = -swing;
      let hornState: "up" | "down" = "up";
      let facingState: "backfield" | "frontfield" | null = null;
      // Resolve the turn from the written count, not the render frame. This
      // also makes rewinding, seeking and multi-count turns deterministic.
      let turnAngle: number | null = null;
      if (marcher) {
        let lastFacingAngle: number | null = null;
        for (const command of drill.instructions ?? []) {
          if (!matchesTarget(command.target, marcher)) continue;
          const commandPage = command.pageIndex;
          const commandCount = Math.max(1, command.count);
          const started =
            commandPage < instructionPageIndex ||
            (commandPage === instructionPageIndex &&
              countPosition >= commandCount - 1);
          if (command.action === "horn") {
            if (
              commandPage < instructionPageIndex ||
              (commandPage === instructionPageIndex &&
                commandCount <= instructionCount)
            ) {
              hornState = command.value as "up" | "down";
            }
            continue;
          }
          if (command.action !== "facing" || !started) continue;
          const targetAngle = command.value === "backfield" ? Math.PI : 0;
          const duration = Math.max(1, Number(command.durationCounts) || 1);
          const direction = command.shoulder ?? "shortest";
          const startAngle: number =
            lastFacingAngle ??
            THREE.MathUtils.degToRad(
              -(
                prepared[Math.max(0, commandPage - 1)]?.[i]?.rotation ??
                a.rotation
              ),
            );
          let delta = wrapRadians(targetAngle - startAngle);
          // In Three.js, negative yaw turns toward the performer's right.
          if (direction === "right" && delta > 0) delta -= Math.PI * 2;
          if (direction === "left" && delta < 0) delta += Math.PI * 2;
          const progress =
            commandPage < instructionPageIndex
              ? 1
              : THREE.MathUtils.clamp(
                  (countPosition - (commandCount - 1)) / duration,
                  0,
                  1,
                );
          const smooth = progress * progress * (3 - 2 * progress);
          lastFacingAngle = startAngle + delta * smooth;
          turnAngle = lastFacingAngle;
          facingState = command.value as "backfield" | "frontfield";
        }
      }

      const bassScale =
        instrument === "bass"
          ? (bassScaleById.get(marcher?.id ?? -1) ?? 0.94)
          : 1;
      // Keep a real air gap between the marcher and the near edge of every bass
      // drum. Because the drum radius grows with scale, larger basses must sit
      // farther forward to preserve the same gap.
      const bassForwardZ = -(0.58 + 0.72 * bassScale);

      position.set(x, 0, z);
      // Bass drums are staged facing the opposite (left) end zone. With March3D's
      // coordinate system, +90 degrees turns the bass line toward world -X.
      // Drum heads remain oriented toward the sidelines.
      const facingRad =
        instrument === "bass"
          ? Math.PI / 2
          : THREE.MathUtils.degToRad(-rotation);
      const visualFacingAngle = turnAngle ?? facingRad;
      quaternion.setFromAxisAngle(axisY, visualFacingAngle);
      root.compose(position, quaternion, scale);

      // Foot direction follows travel when marching forwards or backwards.
      // Slides of <=90 degrees point toward the 50-yard line; slides beyond
      // 90 degrees switch the feet to the opposite travel-facing direction.
      let movementDelta = 0;
      let backwardMarch = false;
      let crabAmount = 0;
      let crabDirection = 0;
      // A slide is a movement across the performer's facing, not necessarily
      // a movement along the field's X axis. Detect it using the relative
      // travel/facing angle so backfield-facing slides are handled as well.
      // The 50-yard line is world X=0 (see positionToField above).
      const towardFiftyAngle =
        x > 0.01
          ? Math.PI / 2
          : x < -0.01
            ? -Math.PI / 2
            : dx < 0
              ? Math.PI / 2
              : -Math.PI / 2;
      let footFacingAngle = visualFacingAngle;
      if (isMoving && !markTime) {
        const travelAngle = Math.atan2(-dx, -dz);
        movementDelta = wrapRadians(travelAngle - visualFacingAngle);
        const absoluteDelta = Math.abs(movementDelta);
        backwardMarch = absoluteDelta > Math.PI / 2;

        // Slides are primarily sideways relative to the upper body. Include
        // lateral field travel as a fallback for formations facing end zones.
        const slidingRelativeToBody = Math.abs(Math.sin(movementDelta)) >= 0.65;
        const slidingAcrossField = Math.abs(dx) > Math.abs(dz) * 0.75;
        const slide = slidingRelativeToBody || slidingAcrossField;
        if (slide && !battery) {
          footFacingAngle = towardFiftyAngle;
        } else {
          footFacingAngle = backwardMarch ? travelAngle + Math.PI : travelAngle;
        }
        if (guard) {
          // Guard footwork follows the actual diagonal pathway, rather than
          // snapping to the 50-yard-line direction whenever a move is called
          // a slide. For a 45-degree path this yields a 45-degree hip turn;
          // a true lateral path can still produce the full 90 degrees.
          // Choose the forward/backward travel heading closest to the torso,
          // then limit the relative turn to 90 degrees.
          const guardTravelFacing = backwardMarch
            ? travelAngle + Math.PI
            : travelAngle;
          const guardFootDelta = wrapRadians(
            guardTravelFacing - visualFacingAngle,
          );
          const maxGuardTurn = Math.PI / 2;
          footFacingAngle =
            visualFacingAngle +
            THREE.MathUtils.clamp(guardFootDelta, -maxGuardTurn, maxGuardTurn);
        }
        if (battery) {
          crabAmount = 1;
          crabDirection = Math.sign(Math.sin(movementDelta)) || 1;
          footFacingAngle = visualFacingAngle;
        }
      } else {
        // At a halt, keep the feet square with the upper body. The 50-yard
        // line orientation is only used during an active slide, never a hold.
        footFacingAngle = visualFacingAngle;
      }
      quaternion.setFromAxisAngle(axisY, footFacingAngle);
      lowerRoot.compose(position, quaternion, scale);

      const backwardSign = backwardMarch ? -1 : 1;
      const normalLegAngle = swing * solvedLegAngle * backwardSign;
      const normalOtherLegAngle = oppositeSwing * solvedLegAngle * backwardSign;
      const crabAngle =
        swing * solvedLegAngle * 0.92 * crabAmount * crabDirection;
      const crabOtherAngle = -crabAngle;
      const legAngle =
        battery && crabAmount > 0.15 ? crabAngle : normalLegAngle;
      const otherLegAngle =
        battery && crabAmount > 0.15 ? crabOtherAngle : normalOtherLegAngle;
      // Battery hands stay much steadier while crabbing; winds retain a normal
      // counter-swing until instrument-specific poses are added.
      const hasWindInstrument = !battery && instrument !== "none";
      const armScale = battery ? 0.08 : 1;
      const playingArmAngle =
        instrument === "clarinet" || instrument === "sax"
          ? THREE.MathUtils.degToRad(-36)
          : instrument === "baritone" || instrument === "trombone"
            ? THREE.MathUtils.degToRad(-48)
            : instrument === "tuba"
              ? THREE.MathUtils.degToRad(-34)
              : THREE.MathUtils.degToRad(-58);
      const armAngle = hasWindInstrument
        ? playingArmAngle
        : oppositeSwing * THREE.MathUtils.degToRad(20) * armScale;
      const otherArmAngle = hasWindInstrument
        ? playingArmAngle
        : swing * THREE.MathUtils.degToRad(20) * armScale;
      const bodyBob = gaitMoving ? gaitWave * 0.045 : 0;

      // Apply the body pulse after the facing/travel roots are built so every
      // body part remains on the same vertical reference.
      position.y = PERFORMER_GROUND_LIFT + bodyBob;
      root.setPosition(position);
      lowerRoot.setPosition(position);

      t1.makeTranslation(0, 1.78, 0);
      result.multiplyMatrices(root, t1);
      torso.setMatrixAt(i, result);

      t1.makeTranslation(0, 2.98, 0);
      result.multiplyMatrices(root, t1);
      head.setMatrixAt(i, result);

      if (guard) {
        shako.setMatrixAt(i, hiddenMatrix);
        plume.setMatrixAt(i, hiddenMatrix);
      } else {
        t1.makeTranslation(0, 3.37, 0);
        result.multiplyMatrices(root, t1);
        shako.setMatrixAt(i, result);

        t1.makeTranslation(0, 3.86, -0.03);
        result.multiplyMatrices(root, t1);
        plume.setMatrixAt(i, result);
      }

      // Legs rotate from the hip. Battery uses Z-axis leg motion for a crab
      // step (including a small crossover shift); everyone else swings in the
      // sagittal plane, including reversed swing for a true back march.
      for (let side = 0; side < 2; side++) {
        const baseX = side === 0 ? -0.27 : 0.27;
        const angle = side === 0 ? legAngle : otherLegAngle;
        const crabbing = battery && crabAmount > 0.15;
        const crossover = crabbing
          ? swing * 0.16 * crabDirection * (side === 0 ? 1 : -1)
          : 0;
        t1.makeTranslation(baseX + crossover, 1.02, 0);
        if (crabbing) t2.makeRotationZ(angle);
        else t2.makeRotationX(angle);
        multiplyParts(result, lowerRoot, t1, t2);
        t3.makeTranslation(0, -LEG_LENGTH / 2, 0);
        result.multiply(t3);
        legs.setMatrixAt(i * 2 + side, result);

        t3.makeTranslation(0, -LEG_LENGTH, -0.18);
        multiplyParts(result, lowerRoot, t1, t2, t3);
        feet.setMatrixAt(i * 2 + side, result);
      }

      // Two-piece arms. Instrument players use explicit shoulder -> elbow ->
      // hand targets so the hands actually contact the instrument. The pose
      // values are scalars (rather than temporary objects) to keep large-band
      // playback allocation-free. Free arms retain the gait-driven swing.
      for (let side = 0; side < 2; side++) {
        const left = side === 0;
        const sx = left ? -0.46 : 0.46;
        let hasPose = true;
        let ex = 0,
          ey = 0,
          ez = 0,
          hx = 0,
          hy = 0,
          hz = 0;

        switch (instrument) {
          case "flute":
            if (left) {
              ex = -0.12;
              ey = 2.35;
              ez = -0.52;
              hx = 0.39;
              hy = 2.71;
              hz = -0.42;
            } else {
              ex = 0.92;
              ey = 2.05;
              ez = -0.24;
              hx = 0.91;
              hy = 2.71;
              hz = -0.32;
            }
            break;
          case "clarinet":
            if (left) {
              ex = -0.42;
              ey = 2.28;
              ez = -0.24;
              hx = -0.12;
              hy = 2.43;
              hz = -0.48;
            } else {
              ex = 0.43;
              ey = 2.18;
              ez = -0.23;
              hx = 0.11;
              hy = 2.16;
              hz = -0.53;
            }
            break;
          case "sax":
            if (left) {
              ex = -0.42;
              ey = 2.3;
              ez = -0.18;
              hx = -0.08;
              hy = 2.38;
              hz = -0.48;
            } else {
              ex = 0.45;
              ey = 2.1;
              ez = -0.18;
              hx = 0.18;
              hy = 2.1;
              hz = -0.55;
            }
            break;
          case "trumpet":
            if (left) {
              ex = -0.49;
              ey = 2.4;
              ez = -0.58;
              hx = -0.13;
              hy = 2.71;
              hz = -0.76;
            } else {
              ex = 0.49;
              ey = 2.4;
              ez = -0.58;
              hx = 0.09;
              hy = 2.84;
              hz = -0.76;
            }
            break;
          case "mello":
            if (left) {
              ex = -0.52;
              ey = 2.28;
              ez = -0.57;
              hx = -0.14;
              hy = 2.72;
              hz = -0.72;
            } else {
              ex = 0.52;
              ey = 2.28;
              ez = -0.57;
              hx = 0.1;
              hy = 2.77;
              hz = -0.75;
            }
            break;
          case "baritone":
            if (left) {
              ex = -0.52;
              ey = 2.28;
              ez = -0.57;
              hx = -0.12;
              hy = 2.68;
              hz = -0.78;
            } else {
              ex = 0.52;
              ey = 2.28;
              ez = -0.57;
              hx = 0.1;
              hy = 2.74;
              hz = -0.75;
            }
            break;
          case "trombone":
            if (left) {
              ex = -0.68;
              ey = 2.48;
              ez = -0.55;
              hx = -0.15;
              hy = 2.78;
              hz = -0.48;
            } else {
              ex = 0.45;
              ey = 2.28;
              ez = -0.75;
              hx = -0.15;
              hy = 2.66;
              hz = -0.96;
            }
            break;
          case "tuba":
            if (left) {
              ex = -0.58;
              ey = 2.3;
              ez = -0.05;
              hx = -0.35;
              hy = 2.48;
              hz = -0.19;
            } else {
              ex = 0.45;
              ey = 2.26;
              ez = -0.12;
              hx = 0.05;
              hy = 2.46;
              hz = -0.32;
            }
            break;
          case "snare":
            if (left) {
              ex = -0.48;
              ey = 2.12;
              ez = -0.3;
              hx = -0.23;
              hy = 2.1;
              hz = -0.82;
            } else {
              ex = 0.48;
              ey = 2.12;
              ez = -0.3;
              hx = 0.23;
              hy = 2.1;
              hz = -0.82;
            }
            break;
          case "tenors":
            if (left) {
              ex = -0.5;
              ey = 2.08;
              ez = -0.3;
              hx = -0.3;
              hy = 1.9;
              hz = -0.88;
            } else {
              ex = 0.5;
              ey = 2.08;
              ez = -0.3;
              hx = 0.3;
              hy = 1.9;
              hz = -0.88;
            }
            break;
          case "toms":
            if (left) {
              ex = -0.48;
              ey = 2.12;
              ez = -0.3;
              hx = -0.23;
              hy = 2.0;
              hz = -0.82;
            } else {
              ex = 0.48;
              ey = 2.12;
              ez = -0.3;
              hx = 0.23;
              hy = 2.0;
              hz = -0.82;
            }
            break;
          case "flag":
            // Two-handed flag carry in front of the body.
            if (left) {
              ex = -0.38;
              ey = 2.25;
              ez = -0.22;
              hx = -0.08;
              hy = 1.9;
              hz = -0.5;
            } else {
              ex = 0.38;
              ey = 1.95;
              ez = -0.2;
              hx = 0.08;
              hy = 1.9;
              hz = -0.5;
            }
            break;
          case "rifle":
            // Rifle carried horizontally across the chest with both hands.
            if (left) {
              ex = -0.43;
              ey = 2.28;
              ez = -0.24;
              hx = -0.28;
              hy = 2.32;
              hz = -0.52;
            } else {
              ex = 0.43;
              ey = 2.2;
              ez = -0.22;
              hx = 0.3;
              hy = 2.28;
              hz = -0.52;
            }
            break;
          case "bass":
            // Bass hands follow the drum outward as its size increases. The
            // drum heads are local +/-X, while local -Z is forward.
            if (left) {
              ex = -0.55;
              ey = 2.1;
              ez = -0.4;
              hx = -0.5 * bassScale;
              hy = 2.14;
              hz = bassForwardZ + 0.2;
            } else {
              ex = 0.55;
              ey = 2.1;
              ez = -0.4;
              hx = 0.5 * bassScale;
              hy = 2.14;
              hz = bassForwardZ + 0.2;
            }
            break;
          case "cymbals":
            if (left) {
              ex = -0.55;
              ey = 2.1;
              ez = -0.4;
              hx = -0.5;
              hy = 2.0;
              hz = -0.95;
            } else {
              ex = 0.55;
              ey = 2.1;
              ez = -0.4;
              hx = 0.5;
              hy = 2.0;
              hz = -0.95;
            }
            break;
          default:
            hasPose = false;
        }

        if (hasPose) {
          setLimbMatrix(
            arms,
            i * 2 + side,
            root,
            sx,
            2.43,
            0,
            ex,
            ey,
            ez,
            UPPER_ARM_LENGTH,
          );
          setLimbMatrix(
            forearms,
            i * 2 + side,
            root,
            ex,
            ey,
            ez,
            hx,
            hy,
            hz,
            FOREARM_LENGTH,
          );
          t1.makeTranslation(hx, hy, hz);
          result.multiplyMatrices(root, t1);
          hands.setMatrixAt(i * 2 + side, result);
        } else {
          const angle = side === 0 ? armAngle : otherArmAngle;
          t1.makeTranslation(sx, 2.43, 0);
          t2.makeRotationX(angle);
          multiplyParts(t4, root, t1, t2);
          t3.makeTranslation(0, -UPPER_ARM_LENGTH / 2, 0);
          result.copy(t4).multiply(t3);
          arms.setMatrixAt(i * 2 + side, result);

          t5.makeTranslation(0, -UPPER_ARM_LENGTH, 0);
          t6.makeRotationX(THREE.MathUtils.degToRad(8));
          t4.multiply(t5).multiply(t6);
          t3.makeTranslation(0, -FOREARM_LENGTH / 2, 0);
          result.copy(t4).multiply(t3);
          forearms.setMatrixAt(i * 2 + side, result);
          t3.makeTranslation(0, -FOREARM_LENGTH - 0.08, 0);
          result.copy(t4).multiply(t3);
          hands.setMatrixAt(i * 2 + side, result);
        }
      }

      // Instruments are intentionally simple low-poly geometry so even very
      // large bands stay fast. Every instrument mesh is instanced; marchers who
      // do not use a given instrument get a zero-scale matrix. Instruments are
      // attached to the upper-body root so slides/crab steps do not rotate them
      // with the legs.
      for (const mesh of Object.values(instrumentMeshes))
        mesh!.setMatrixAt(i, hiddenMatrix);
      const shownInstrument = guard ? guardEquipment : instrument;
      const instrumentMesh =
        (instrument === "none" && !guard) || (guard && !hasEquipment)
          ? null
          : shownInstrument === "none"
            ? null
            : instrumentMeshes[shownInstrument];
      if (instrumentMesh) {
        if (instrument === "flute") {
          t1.makeTranslation(0.02, 2.62, -0.72);
          t2.makeRotationZ(-Math.PI / 2);
          multiplyParts(result, root, t1, t2);
        } else if (instrument === "clarinet") {
          t1.makeTranslation(0, 2.25, -0.58);
          t2.makeRotationX(THREE.MathUtils.degToRad(22));
          multiplyParts(result, root, t1, t2);
        } else if (instrument === "sax") {
          t1.makeTranslation(0, 2.12, -0.58);
          t2.makeRotationX(THREE.MathUtils.degToRad(18));
          multiplyParts(result, root, t1, t2);
        } else if (instrument === "trumpet") {
          t1.makeTranslation(0, 2.66, -0.76);
          t2.makeRotationX(Math.PI / 2);
          multiplyParts(result, root, t1, t2);
        } else if (instrument === "mello") {
          t1.makeTranslation(0, 2.62, -0.74);
          t2.makeRotationX(Math.PI / 2);
          multiplyParts(result, root, t1, t2);
        } else if (instrument === "baritone") {
          t1.makeTranslation(0, 2.62, -0.74);
          t2.makeRotationX(Math.PI / 2);
          multiplyParts(result, root, t1, t2);
        } else if (instrument === "trombone") {
          t1.makeTranslation(0, 2.56, -0.78);
          t2.makeRotationX(-Math.PI / 2);
          multiplyParts(result, root, t1, t2);
        } else if (instrument === "tuba") {
          if (tubaModel === "contrabassBugle") {
            t1.makeTranslation(0.0, 2.05, -0.08);
          } else {
            t1.makeTranslation(0.0, 2.1, -0.01);
          }
          t2.identity();
          multiplyParts(result, root, t1, t2);
        } else if (instrument === "snare") {
          t1.makeTranslation(0, 1.88, -0.72);
          t2.identity();
          multiplyParts(result, root, t1, t2);
        } else if (instrument === "tenors") {
          t1.makeTranslation(0, 1.88, -0.78);
          t2.identity();
          multiplyParts(result, root, t1, t2);
        } else if (instrument === "cymbals") {
          t1.makeTranslation(0, 1.98, -0.98);
          t2.identity();
          multiplyParts(result, root, t1, t2);
        } else if (instrument === "toms") {
          t1.makeTranslation(0, 1.88, -0.72);
          t2.identity();
          multiplyParts(result, root, t1, t2);
        } else if (shownInstrument === "flag" && guard) {
          // Pole stays vertical and just in front of the guard performer.
          t1.makeTranslation(0, 2.15, -0.54);
          t2.identity();
          multiplyParts(result, root, t1, t2);
        } else if (
          guard &&
          (shownInstrument === "rifle" || shownInstrument === "saber")
        ) {
          // Rifle sits horizontally across the front of the chest.
          t1.makeTranslation(0, 2.3, -0.56);
          t2.makeRotationZ(Math.PI / 2);
          multiplyParts(result, root, t1, t2);
        } else {
          // bass drum
          // Drum axis is local X, so with the bass marcher facing the right end
          // zone the two heads still face the sidelines. Position is derived
          // from radius * scale, so larger drums automatically sit farther away
          // and every marcher has visible space between body and shell.
          t1.makeTranslation(0, 2.12, bassForwardZ);
          t2.identity();
          multiplyParts(result, root, t1, t2);

          t3.makeScale(bassScale, bassScale, bassScale);
          result.multiply(t3);
        }
        if (guard && guardMotion !== "none") {
          // Compute a stable absolute written-beat coordinate. Pausing, seeking,
          // slowing playback and crossing page boundaries never change the pose
          // at the same drill time.
          const currentBeat = moveStartBeatIndex + countPosition;
          const originBeat =
            (drill.pages[guardMotionStartPage]?.startBeatIndex ?? 0) +
            guardMotionStartCount -
            1;
          const beatsSinceStart = Math.max(0, currentBeat - originBeat);
          if (guardMotion === "spinning") {
            // One full equipment rotation per written count.
            t3.makeRotationZ(beatsSinceStart * Math.PI * 2);
            result.multiply(t3);
          } else if (guardMotion === "tossing") {
            // A finite, repeatable toss with a parabolic rise and full rotation.
            // After the requested duration, return to the carry position.
            const progress = THREE.MathUtils.clamp(
              beatsSinceStart / guardMotionDuration,
              0,
              1,
            );
            t3.makeTranslation(0, Math.sin(Math.PI * progress) * 2.4, 0);
            result.multiply(t3);
            t3.makeRotationZ(progress * Math.PI * 2);
            result.multiply(t3);
          }
        }
        if (hornState === "down" && !battery && !guard) {
          // Rotate the instrument around its mount point into a resting pose.
          t3.makeRotationX(
            THREE.MathUtils.degToRad(HORN_DOWN_ANGLES[instrument]),
          );
          result.multiply(t3);
        }
        instrumentMesh!.setMatrixAt(i, result);
      }

      if (lastColors.current[i] !== a.color) {
        colorScratch.set(a.color);
        torso.setColorAt(i, colorScratch);
        shako.setColorAt(i, colorScratch);
        plume.setColorAt(i, colorScratch);
        arms.setColorAt(i * 2, colorScratch);
        arms.setColorAt(i * 2 + 1, colorScratch);
        forearms.setColorAt(i * 2, colorScratch);
        forearms.setColorAt(i * 2 + 1, colorScratch);
        lastColors.current[i] = a.color;
        colorsChanged = true;
      }

      const label = labelRefs.current.get(i);
      if (label) {
        label.visible = true;
        label.position.set(x, 4.25 + bodyBob, z);
      }
    }

    for (const mesh of [
      torso,
      head,
      shako,
      plume,
      arms,
      forearms,
      hands,
      legs,
      feet,
      ...Object.values(instrumentMeshes),
    ])
      mesh!.instanceMatrix.needsUpdate = true;
    if (colorsChanged) {
      for (const mesh of [torso, shako, plume, arms, forearms]) {
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
  });

  const castMarcherShadows = drill.marchers.length <= 140;

  return (
    <group>
      <instancedMesh
        ref={torsoRef}
        args={[undefined, undefined, INSTANCE_CAPACITY]}
        castShadow={castMarcherShadows}
        frustumCulled={false}
      >
        <cylinderGeometry args={[0.36, 0.46, 1.66, 12]} />
        <meshStandardMaterial roughness={0.72} />
      </instancedMesh>
      <instancedMesh
        ref={headRef}
        args={[undefined, undefined, INSTANCE_CAPACITY]}
        castShadow={castMarcherShadows}
        frustumCulled={false}
      >
        <sphereGeometry args={[0.29, 12, 10]} />
        <meshStandardMaterial color="#d9a67d" roughness={0.78} />
      </instancedMesh>
      <instancedMesh
        ref={shakoRef}
        args={[undefined, undefined, INSTANCE_CAPACITY]}
        castShadow={castMarcherShadows}
        frustumCulled={false}
      >
        <primitive attach="geometry" object={shakoMeshGeometry} />
        <meshStandardMaterial roughness={0.68} />
      </instancedMesh>
      <instancedMesh
        ref={plumeRef}
        args={[undefined, undefined, INSTANCE_CAPACITY]}
        castShadow={castMarcherShadows}
        frustumCulled={false}
      >
        <primitive attach="geometry" object={plumeMeshGeometry} />
        <meshStandardMaterial roughness={0.72} />
      </instancedMesh>
      <instancedMesh
        ref={armsRef}
        args={[undefined, undefined, INSTANCE_CAPACITY * 2]}
        castShadow={castMarcherShadows}
        frustumCulled={false}
      >
        <cylinderGeometry args={[0.1, 0.12, UPPER_ARM_LENGTH, 7]} />
        <meshStandardMaterial roughness={0.76} />
      </instancedMesh>
      <instancedMesh
        ref={forearmsRef}
        args={[undefined, undefined, INSTANCE_CAPACITY * 2]}
        castShadow={castMarcherShadows}
        frustumCulled={false}
      >
        <cylinderGeometry args={[0.085, 0.105, FOREARM_LENGTH, 7]} />
        <meshStandardMaterial roughness={0.76} />
      </instancedMesh>
      <instancedMesh
        ref={handsRef}
        args={[undefined, undefined, INSTANCE_CAPACITY * 2]}
        castShadow={castMarcherShadows}
        frustumCulled={false}
      >
        <sphereGeometry args={[0.12, 8, 6]} />
        <meshStandardMaterial color="#f5f5f2" roughness={0.82} />
      </instancedMesh>
      <instancedMesh
        ref={legsRef}
        args={[undefined, undefined, INSTANCE_CAPACITY * 2]}
        castShadow={castMarcherShadows}
        frustumCulled={false}
      >
        <cylinderGeometry args={[0.12, 0.15, LEG_LENGTH, 7]} />
        <meshStandardMaterial color="#1d2229" roughness={0.82} />
      </instancedMesh>
      <instancedMesh
        ref={feetRef}
        args={[undefined, undefined, INSTANCE_CAPACITY * 2]}
        castShadow={castMarcherShadows}
        frustumCulled={false}
      >
        <boxGeometry args={[0.26, 0.15, 0.56]} />
        <meshStandardMaterial color="#101318" roughness={0.9} />
      </instancedMesh>

      {/* Section instruments. These stay intentionally low-poly and instanced. */}
      <instancedMesh
        ref={fluteRef}
        args={[undefined, undefined, INSTANCE_CAPACITY]}
        castShadow={castMarcherShadows}
        frustumCulled={false}
      >
        <primitive attach="geometry" object={fluteGeometry} />
        <meshStandardMaterial
          color="#d9dde2"
          metalness={0.72}
          roughness={0.28}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      <instancedMesh
        ref={clarinetRef}
        args={[undefined, undefined, INSTANCE_CAPACITY]}
        castShadow={castMarcherShadows}
        frustumCulled={false}
      >
        <primitive attach="geometry" object={clarinetGeometry} />
        <meshStandardMaterial
          color="#111319"
          metalness={0.15}
          roughness={0.48}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      <instancedMesh
        ref={saxRef}
        args={[undefined, undefined, INSTANCE_CAPACITY]}
        castShadow={castMarcherShadows}
        frustumCulled={false}
      >
        <primitive attach="geometry" object={saxGeometry} />
        <meshStandardMaterial
          color="#d9b75f"
          metalness={0.68}
          roughness={0.32}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      <instancedMesh
        ref={trumpetRef}
        args={[undefined, undefined, INSTANCE_CAPACITY]}
        castShadow={castMarcherShadows}
        frustumCulled={false}
      >
        <primitive attach="geometry" object={trumpetGeometry} />
        <meshStandardMaterial
          color="#ffd453"
          metalness={0.72}
          roughness={0.3}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      <instancedMesh
        ref={melloRef}
        args={[undefined, undefined, INSTANCE_CAPACITY]}
        castShadow={castMarcherShadows}
        frustumCulled={false}
      >
        <primitive attach="geometry" object={melloGeometry} />
        <meshStandardMaterial
          color="#fcd663"
          metalness={0.72}
          roughness={0.4}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      <instancedMesh
        ref={baritoneRef}
        args={[undefined, undefined, INSTANCE_CAPACITY]}
        castShadow={castMarcherShadows}
        frustumCulled={false}
      >
        <primitive attach="geometry" object={baritoneGeometry} />
        <meshStandardMaterial
          color="#fcd663"
          metalness={0.72}
          roughness={0.3}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      <instancedMesh
        ref={tromboneRef}
        args={[undefined, undefined, INSTANCE_CAPACITY]}
        castShadow={castMarcherShadows}
        frustumCulled={false}
      >
        <primitive attach="geometry" object={tromboneGeometry} />
        <meshStandardMaterial
          color="#e6c86f"
          metalness={0.72}
          roughness={0.3}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      <instancedMesh
        ref={tubaRef}
        args={[undefined, undefined, INSTANCE_CAPACITY]}
        castShadow={castMarcherShadows}
        frustumCulled={false}
      >
        <primitive attach="geometry" object={tubaGeometry} />
        <meshStandardMaterial
          color="#d7bd72"
          metalness={0.72}
          roughness={0.3}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      <instancedMesh
        ref={snareRef}
        args={[undefined, undefined, INSTANCE_CAPACITY]}
        castShadow={castMarcherShadows}
        frustumCulled={false}
      >
        <primitive attach="geometry" object={snareGeometry} />
        <meshStandardMaterial
          color="#e1e4e8"
          metalness={0.6}
          roughness={0.36}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      <instancedMesh
        ref={tenorsRef}
        args={[undefined, undefined, INSTANCE_CAPACITY]}
        castShadow={castMarcherShadows}
        frustumCulled={false}
      >
        <primitive attach="geometry" object={tenorsGeometry} />
        <meshStandardMaterial
          color="#e1e4e8"
          metalness={0.52}
          roughness={0.4}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      <instancedMesh
        ref={bassDrumRef}
        args={[undefined, undefined, INSTANCE_CAPACITY]}
        castShadow={castMarcherShadows}
        frustumCulled={false}
      >
        <primitive attach="geometry" object={bassGeometry} />
        <meshStandardMaterial
          color="#e1e4e8"
          metalness={0.48}
          roughness={0.42}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      <instancedMesh
        ref={cymbalsRef}
        args={[undefined, undefined, INSTANCE_CAPACITY]}
        castShadow={castMarcherShadows}
        frustumCulled={false}
      >
        <primitive attach="geometry" object={cymbalsGeometry} />
        <meshStandardMaterial
          color="#f3ff11"
          metalness={0.7}
          roughness={0.22}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      <instancedMesh
        ref={tomsRef}
        args={[undefined, undefined, INSTANCE_CAPACITY]}
        castShadow={castMarcherShadows}
        frustumCulled={false}
      >
        <primitive attach="geometry" object={tomsGeometry} />
        <meshStandardMaterial
          color="#e1e4e8"
          metalness={0.6}
          roughness={0.36}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      <instancedMesh
        ref={flagRef}
        args={[undefined, undefined, INSTANCE_CAPACITY]}
        castShadow={castMarcherShadows}
        frustumCulled={false}
      >
        <primitive attach="geometry" object={flagGeometry} />
        <meshStandardMaterial
          color="#8b5cf6"
          metalness={0.18}
          roughness={0.48}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      <instancedMesh
        ref={rifleRef}
        args={[undefined, undefined, INSTANCE_CAPACITY]}
        castShadow={castMarcherShadows}
        frustumCulled={false}
      >
        <primitive attach="geometry" object={rifleGeometry} />
        <meshStandardMaterial
          color="#d7c5a3"
          metalness={0.08}
          roughness={0.62}
          side={THREE.DoubleSide}
        />
      </instancedMesh>

      <instancedMesh
        ref={saberRef}
        args={[undefined, undefined, INSTANCE_CAPACITY]}
        castShadow={castMarcherShadows}
        frustumCulled={false}
      >
        <primitive attach="geometry" object={saberGeometry} />
        <meshStandardMaterial
          color="#c0c8d2"
          metalness={0.65}
          roughness={0.25}
          side={THREE.DoubleSide}
        />
      </instancedMesh>

      {showDomLabels &&
        drill.marchers.map((m, i) => (
          <group
            key={`label-${m.id}`}
            ref={(node) => {
              if (node) labelRefs.current.set(i, node);
              else labelRefs.current.delete(i);
            }}
          >
            <Html distanceFactor={18} position={[0, 0, 0]}>
              <div className="marcher-label">
                {m.drillPrefix}
                {m.drillOrder}
              </div>
            </Html>
          </group>
        ))}
    </group>
  );
}
