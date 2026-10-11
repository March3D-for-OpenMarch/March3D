import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { memo, useEffect, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import Field from "./Field";
import Marchers, { type TubaModel } from "./Marchers";
import type { Drill } from "../lib/dots";

type CameraChange = (
  azimuth: number,
  elevation: number,
  distance: number,
) => void;

function CameraController({
  resetToken,
  azimuth,
  elevation,
  distance,
  onCameraChange,
}: {
  resetToken: string;
  azimuth: number;
  elevation: number;
  distance: number;
  onCameraChange: CameraChange;
}) {
  const { camera } = useThree();
  const controls = useRef<any>(null);
  const onCameraChangeRef = useRef(onCameraChange);
  const applyingRef = useRef(false);
  const lastReportedRef = useRef("");

  useEffect(() => {
    onCameraChangeRef.current = onCameraChange;
  }, [onCameraChange]);

  useEffect(() => {
    const radians = THREE.MathUtils.degToRad;
    const polar = radians(90 - elevation);
    const theta = radians(azimuth + 180);
    applyingRef.current = true;
    camera.position.set(
      distance * Math.sin(polar) * Math.sin(theta),
      distance * Math.cos(polar),
      distance * Math.sin(polar) * Math.cos(theta),
    );
    camera.lookAt(0, 0, 0);
    controls.current?.target.set(0, 0, 0);
    controls.current?.update();
    applyingRef.current = false;
  }, [camera, resetToken, azimuth, elevation, distance]);

  const handleChange = () => {
    if (applyingRef.current || !controls.current) return;
    const offset = camera.position.clone().sub(controls.current.target);
    const radius = offset.length();
    if (radius < 0.001) return;
    const theta = THREE.MathUtils.radToDeg(Math.atan2(offset.x, offset.z));
    const angle = THREE.MathUtils.radToDeg(
      Math.asin(THREE.MathUtils.clamp(offset.y / radius, -1, 1)),
    );
    const nextAzimuth = Math.round(
      THREE.MathUtils.euclideanModulo(theta, 360) - 180,
    );
    const nextElevation = Math.round(angle);
    const nextDistance = Math.round(radius);
    const signature = `${nextAzimuth}:${nextElevation}:${nextDistance}`;
    if (signature === lastReportedRef.current) return;
    lastReportedRef.current = signature;
    onCameraChangeRef.current(nextAzimuth, nextElevation, nextDistance);
  };

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
      onEnd={handleChange}
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
  cameraAzimuth,
  cameraElevation,
  cameraDistance,
  onCameraChange,
}: {
  drill: Drill;
  labels: boolean;
  pageTimes?: number[];
  playheadRef: MutableRefObject<number>;
  resetToken: string;
  forceMarcherRedraw: boolean;
  tubaModel: TubaModel;
  cameraAzimuth: number;
  cameraElevation: number;
  cameraDistance: number;
  onCameraChange: CameraChange;
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
      <CameraController
        resetToken={resetToken}
        azimuth={cameraAzimuth}
        elevation={cameraElevation}
        distance={cameraDistance}
        onCameraChange={onCameraChange}
      />
    </Canvas>
  );
}

export default memo(Scene);
