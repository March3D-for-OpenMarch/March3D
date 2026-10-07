import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { memo, useEffect, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import Field from "./Field";
import Marchers, { type TubaModel } from "./Marchers";
import type { Drill } from "../lib/dots";

function CameraController({ resetToken }: { resetToken: string }) {
  const { camera } = useThree();
  const controls = useRef<any>(null);

  useEffect(() => {
    const perspective = camera as THREE.PerspectiveCamera;
    perspective.position.set(0, 215, -315);
    perspective.lookAt(0, 0, 0);
    perspective.updateProjectionMatrix();
    controls.current?.target.set(0, 0, 0);
    controls.current?.update();
  }, [camera, resetToken]);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={[0, 0, 0]}
      minDistance={18}
      maxDistance={850}
      minPolarAngle={0.03}
      maxPolarAngle={Math.PI / 2 - 0.025}
      enableDamping
      dampingFactor={0.08}
    />
  );
}

function Scene({
  drill,
  labels,
  pageTimes,
  playheadRef,
  resetToken,
  forceMarcherRedraw,
  tubaModel,
}: {
  drill: Drill;
  labels: boolean;
  pageTimes?: number[];
  playheadRef: MutableRefObject<number>;
  resetToken: string;
  forceMarcherRedraw: boolean;
  tubaModel: TubaModel;
}) {
  const largeBand = drill.marchers.length > 160;
  return (
    <Canvas
      shadows={!largeBand}
      dpr={largeBand ? 1 : [1, 1.5]}
      camera={{ position: [0, 215, -315], fov: 45, near: 0.75, far: 1200 }}
    >
      <PerspectiveCamera
        makeDefault
        position={[0, 215, 315]}
        fov={45}
        near={0.75}
        far={1200}
      />
      <color attach="background" args={["#0d1015"]} />
      <ambientLight intensity={1.25} />
      <directionalLight
        position={[80, 180, 120]}
        intensity={2.8}
        castShadow={!largeBand}
        shadow-normalBias={0.025}
        shadow-bias={-0.0001}
      />
      <directionalLight position={[-120, 80, -100]} intensity={0.7} />
      <Field drill={drill} />
      <Marchers
        key={`${resetToken}:${drill.sourceName}:${drill.marchers.length}:${drill.pages.length}`}
        drill={drill}
        labels={labels}
        pageTimes={pageTimes}
        playheadRef={playheadRef}
        forceMarcherRedraw={forceMarcherRedraw}
        tubaModel={tubaModel}
      />
      <CameraController resetToken={resetToken} />
    </Canvas>
  );
}

export default memo(Scene);
