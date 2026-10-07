import { Text, useTexture } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import logoUrl from "../assets/March3D-clear-BLUE.png";
import type { Drill } from "../lib/dots";

const FIELD_LENGTH = 360;
const FIELD_WIDTH = 160;
const PLAYING_LENGTH = 300;
const END_ZONE = 30;
const YARD = 3;
const SURFACE_Y = 0;
const PAINT_Y = 0.004;
const BLUE = "#0f5787";

function hashRowsForDrill(drill: Drill) {
  const feetPerStep = (drill.field.stepSizeInches || 22.5) / 12;
  const checkpoints = drill.field.yCheckpoints ?? [];
  const hashCheckpoints = checkpoints.filter((checkpoint) => {
    const text =
      `${checkpoint.name ?? ""} ${checkpoint.terseName ?? ""}`.toLowerCase();
    return (
      /(^|\s)(fh|bh)(\s|$)/.test(text) ||
      text.includes("front hash") ||
      text.includes("back hash") ||
      text.includes("hash mark")
    );
  });

  if (hashCheckpoints.length >= 2) {
    // OpenMarch's Y checkpoints are measured from the FRONT sideline and are
    // normally negative as they travel toward back field. Convert that exact
    // grid coordinate into March3D's Z axis instead of relying on HS/NCAA
    // hard-coded hash locations.
    const rows = hashCheckpoints
      .map(
        (checkpoint) =>
          -FIELD_WIDTH / 2 - checkpoint.stepsFromCenterFront * feetPerStep,
      )
      .filter(
        (z) =>
          Number.isFinite(z) && z > -FIELD_WIDTH / 2 && z < FIELD_WIDTH / 2,
      )
      .sort((a, b) => a - b);
    if (rows.length >= 2) return [rows[0], rows[rows.length - 1]] as const;
  }

  const name = (drill.field.name ?? "").toLowerCase();
  if (name.includes("high school") || name.includes("hs"))
    return [-26.666667, 26.666667] as const;
  if (name.includes("nfl") || name.includes("pro"))
    return [-9.25, 9.25] as const;
  return [-20, 20] as const;
}

function numberRowsForDrill(drill: Drill) {
  const coords = drill.field.yardNumberCoordinates;
  const feetPerStep = (drill.field.stepSizeInches || 22.5) / 12;
  if (coords) {
    const homeCenterSteps =
      (Number(coords.homeStepsFromFrontToOutside) +
        Number(coords.homeStepsFromFrontToInside)) /
      2;
    const awayCenterSteps =
      (Number(coords.awayStepsFromFrontToInside) +
        Number(coords.awayStepsFromFrontToOutside)) /
      2;
    const homeZ = -FIELD_WIDTH / 2 + homeCenterSteps * feetPerStep;
    const awayZ = -FIELD_WIDTH / 2 + awayCenterSteps * feetPerStep;
    if (Number.isFinite(homeZ) && Number.isFinite(awayZ))
      return [homeZ, awayZ] as const;
  }

  // OpenMarch's standard HS/NCAA field presets place the center of a six-foot
  // numeral about 24 feet in from each sideline. This fallback is only used by
  // older/custom files that do not store yardNumberCoordinates.
  return [-FIELD_WIDTH / 2 + 24, FIELD_WIDTH / 2 - 24] as const;
}

export default function Field({ drill }: { drill: Drill }) {
  const logoTexture = useTexture(logoUrl);
  logoTexture.colorSpace = THREE.SRGBColorSpace;
  logoTexture.anisotropy = 8;

  const halfWidth = FIELD_WIDTH / 2;
  const halfLength = FIELD_LENGTH / 2;
  const leftGoal = -PLAYING_LENGTH / 2;
  const rightGoal = PLAYING_LENGTH / 2;
  const [nearHashZ, farHashZ] = hashRowsForDrill(drill);
  const [homeNumberZ, awayNumberZ] = numberRowsForDrill(drill);

  // Build all white field lines/ticks as one very thin triangle mesh instead of
  // GL lines. The mesh sits essentially flush with the turf and uses polygon
  // offset, which prevents depth-buffer z-fighting without visibly floating the
  // paint above the playing surface.
  const lineGeometry = useMemo(() => {
    const positions: number[] = [];

    const quad = (
      x1: number,
      z1: number,
      x2: number,
      z2: number,
      width: number,
    ) => {
      const dx = x2 - x1;
      const dz = z2 - z1;
      const len = Math.hypot(dx, dz) || 1;
      const px = (-dz / len) * width * 0.5;
      const pz = (dx / len) * width * 0.5;
      const a: [number, number, number] = [x1 + px, PAINT_Y, z1 + pz];
      const b: [number, number, number] = [x1 - px, PAINT_Y, z1 - pz];
      const c: [number, number, number] = [x2 - px, PAINT_Y, z2 - pz];
      const d: [number, number, number] = [x2 + px, PAINT_Y, z2 + pz];
      positions.push(...a, ...b, ...c, ...a, ...c, ...d);
    };

    // Outside border.
    quad(-halfLength, -halfWidth, halfLength, -halfWidth, 0.35);
    quad(halfLength, -halfWidth, halfLength, halfWidth, 0.35);
    quad(halfLength, halfWidth, -halfLength, halfWidth, 0.35);
    quad(-halfLength, halfWidth, -halfLength, -halfWidth, 0.35);

    // Goal lines and 5-yard lines.
    quad(leftGoal, -halfWidth, leftGoal, halfWidth, 0.36);
    quad(rightGoal, -halfWidth, rightGoal, halfWidth, 0.36);
    for (let yard = 0; yard <= 100; yard += 5) {
      const x = leftGoal + yard * YARD;
      quad(x, -halfWidth, x, halfWidth, 0.26);
    }

    // One-yard sideline ticks and hash marks. Hash row positions come from the
    // .dots field checkpoints whenever OpenMarch provides FH/BH coordinates.
    for (let yard = 1; yard < 100; yard++) {
      if (yard % 5 === 0) continue;
      const x = leftGoal + yard * YARD;
      quad(x, -halfWidth, x, -halfWidth + 3.2, 0.2);
      quad(x, halfWidth - 3.2, x, halfWidth, 0.2);
      // Between 5-yard lines, the small one-yard hash marks run 90 degrees
      // to the 5-yard-line hashes. Their inward/field-facing endpoint is kept
      // exactly on the same hash-row coordinate as the horizontal T hashes.
      // That makes the inside edge of every short hash line up cleanly with the
      // horizontal hashes on the yard lines, like the real field reference.
      const betweenHashLength = 1.7;
      // near/front row: center of the field is +Z, so extend outward toward -Z.
      quad(x, nearHashZ - betweenHashLength, x, nearHashZ, 0.2);
      // far/back row: center of the field is -Z, so extend outward toward +Z.
      quad(x, farHashZ, x, farHashZ + betweenHashLength, 0.2);
    }

    for (let yard = 5; yard < 100; yard += 5) {
      const x = leftGoal + yard * YARD;
      // On each 5-yard line, keep the same separated hash length and add the
      // short perpendicular stem on the side closest to midfield. This creates
      // the real-field T shape without turning the hash row into a solid line.
      const hashHalfLength = 0.85;
      const inwardStemLength = 2.2;
      quad(x - hashHalfLength, nearHashZ, x + hashHalfLength, nearHashZ, 0.22);
      quad(x, nearHashZ, x, nearHashZ + inwardStemLength, 0.22);
      quad(x - hashHalfLength, farHashZ, x + hashHalfLength, farHashZ, 0.22);
      quad(x, farHashZ, x, farHashZ - inwardStemLength, 0.22);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }, [farHashZ, halfLength, halfWidth, leftGoal, nearHashZ, rightGoal]);

  const yardLabels = [10, 20, 30, 40, 50, 40, 30, 20, 10];
  const yardXs = [-120, -90, -60, -30, 0, 30, 60, 90, 120];

  return (
    <group>
      {Array.from({ length: 20 }, (_, i) => {
        const stripeLength = PLAYING_LENGTH / 20;
        return (
          <mesh
            key={`stripe-${i}`}
            position={[
              leftGoal + stripeLength * (i + 0.5),
              SURFACE_Y - 0.15,
              0,
            ]}
            receiveShadow
          >
            <boxGeometry args={[stripeLength, 0.3, FIELD_WIDTH]} />
            <meshStandardMaterial
              color={i % 2 === 0 ? "#548f33" : "#477d2c"}
              roughness={1}
            />
          </mesh>
        );
      })}

      <mesh
        position={[-halfLength + END_ZONE / 2, SURFACE_Y - 0.15, 0]}
        receiveShadow
      >
        <boxGeometry args={[END_ZONE, 0.3, FIELD_WIDTH]} />
        <meshStandardMaterial color={BLUE} roughness={0.9} />
      </mesh>
      <mesh
        position={[halfLength - END_ZONE / 2, SURFACE_Y - 0.15, 0]}
        receiveShadow
      >
        <boxGeometry args={[END_ZONE, 0.3, FIELD_WIDTH]} />
        <meshStandardMaterial color={BLUE} roughness={0.9} />
      </mesh>

      <mesh geometry={lineGeometry} renderOrder={1}>
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={0.93}
          depthTest
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {yardLabels.flatMap((yard, i) =>
        [homeNumberZ, awayNumberZ].map((z) => (
          <Text
            key={`number-${i}-${z}`}
            position={[yardXs[i], 0.0025, z]}
            rotation={[-Math.PI / 2, 0, z < 0 ? Math.PI : 0]}
            fontSize={7}
            fontWeight={700}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
            fillOpacity={0.9}
            depthOffset={-2}
          >
            {String(yard)}
          </Text>
        )),
      )}

      <Text
        depthOffset={-2}
        position={[-halfLength + END_ZONE / 2, 0.0025, 0]}
        rotation={[-Math.PI / 2, 0, Math.PI / 2]}
        fontSize={10.5}
        fontWeight={800}
        letterSpacing={-0.03}
        color="#ffffff"
        anchorX="center"
        anchorY="middle"
      >
        MARCH3D
      </Text>
      <Text
        depthOffset={-2}
        position={[halfLength - END_ZONE / 2, 0.0025, 0]}
        rotation={[-Math.PI / 2, 0, -Math.PI / 2]}
        fontSize={10.5}
        fontWeight={800}
        letterSpacing={-0.03}
        color="#ffffff"
        anchorX="center"
        anchorY="middle"
      >
        MARCH3D
      </Text>

      <mesh
        rotation={[-Math.PI / 2, 0, Math.PI]}
        position={[0, 0.003, 0]}
        renderOrder={2}
      >
        <planeGeometry args={[29, 29]} />
        <meshBasicMaterial
          map={logoTexture}
          transparent
          depthWrite={false}
          depthTest
          polygonOffset
          polygonOffsetFactor={-3}
          polygonOffsetUnits={-3}
          toneMapped={false}
          opacity={0.96}
        />
      </mesh>
    </group>
  );
}
