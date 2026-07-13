// Cinematic dark viewer (react-three-fiber + drei). Plays embedded animation
// clips; turntables when there are none. preserveDrawingBuffer lets the parent
// grab a poster frame straight off the canvas.
import { Suspense, useEffect, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, ContactShadows, useAnimations } from "@react-three/drei";
import * as THREE from "three";

/** Paint the scene background into the WebGL buffer so it's captured in posters. */
function SceneBackground({ color }: { color: string | null }) {
  const { scene } = useThree();
  useEffect(() => {
    scene.background = color ? new THREE.Color(color) : null;
    return () => {
      scene.background = null;
    };
  }, [scene, color]);
  return null;
}

/**
 * Auto-frame the model so the WHOLE figure is always centered in view (and in
 * the captured poster), regardless of the model's height or animation pose.
 * Fits the bounding sphere — rotation-invariant, so turntable never clips it.
 */
function FitCamera({ object, animations, margin = 1.1 }: { object: THREE.Object3D; animations: THREE.AnimationClip[]; margin?: number }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as { target: THREE.Vector3; minDistance: number; maxDistance: number; update: () => void } | null;

  useEffect(() => {
    // The skeleton only matches the rendered mesh once the animation has posed
    // it — so wait a beat (the clip is playing by now), then frame from the LIVE
    // bone world positions. Reading bind-pose bones frames the wrong region.
    const fit = () => {
      object.updateWorldMatrix(true, true);

      const bones: THREE.Object3D[] = [];
      object.traverse((o) => {
        if ((o as THREE.Bone).isBone) bones.push(o);
      });

      const box = new THREE.Box3();
      if (bones.length >= 3) {
        const p = new THREE.Vector3();
        for (const b of bones) box.expandByPoint(b.getWorldPosition(p));
        const h = box.getSize(new THREE.Vector3()).y || 1;
        box.expandByVector(new THREE.Vector3(h * 0.05, 0, h * 0.05)); // hands past wrist bones
        box.max.y += h * 0.1; // skull top above the head bone
        box.min.y -= h * 0.03; // soles below the ankle/toe bones
      } else {
        box.setFromObject(object);
      }
      if (box.isEmpty()) return;

      // Ground the figure: drop its feet to the shadow plane (y=0) so the model
      // is never floating and the contact shadow lines up.
      const floor = box.min.y;
      object.position.y -= floor;
      box.min.y -= floor;
      box.max.y -= floor;

      const bsize = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const diag = bsize.length();

      // Fit the box per-axis (height vs width) — a wide arm span never zooms the
      // whole figure out. Pure front view → perfectly centred in frame & poster.
      const persp = camera as THREE.PerspectiveCamera;
      const vFov = (persp.fov * Math.PI) / 180;
      const aspect = size.width / Math.max(1, size.height);
      const fitH = bsize.y / 2 / Math.tan(vFov / 2);
      const fitW = bsize.x / 2 / (Math.tan(vFov / 2) * aspect);
      const dist = Math.max(fitH, fitW) * margin + bsize.z / 2;

      persp.position.set(center.x, center.y, center.z + dist);
      persp.near = Math.max(0.01, dist - diag);
      persp.far = dist + diag * 2;
      persp.updateProjectionMatrix();

      if (controls) {
        controls.target.copy(center);
        controls.minDistance = Math.max(0.1, dist * 0.4);
        controls.maxDistance = dist * 3;
        controls.update();
      } else {
        persp.lookAt(center);
      }
    };

    const id = setTimeout(fit, animations.length ? 220 : 30);
    return () => clearTimeout(id);
  }, [object, animations, camera, controls, size.width, size.height, margin]);

  return null;
}

interface ModelProps {
  object: THREE.Object3D;
  animations: THREE.AnimationClip[];
  animIndex: number;
  playing: boolean;
}

function Model({ object, animations, animIndex, playing }: ModelProps) {
  const ref = useRef<THREE.Group>(null);
  const { actions, names } = useAnimations(animations, ref);

  useEffect(() => {
    const name = names[animIndex];
    Object.values(actions).forEach((a) => a?.fadeOut(0.2));
    if (playing && name && actions[name]) {
      actions[name]!.reset().fadeIn(0.25).play();
    }
    return () => {
      if (name && actions[name]) actions[name]!.fadeOut(0.2);
    };
  }, [actions, names, animIndex, playing]);

  return (
    <group ref={ref}>
      <primitive object={object} />
    </group>
  );
}

export interface Viewer3DProps {
  object: THREE.Object3D;
  animations: THREE.AnimationClip[];
  animIndex: number;
  autoRotate: boolean;
  background?: string | null;
  onCanvas?: (el: HTMLCanvasElement) => void;
}

export function Viewer3D({ object, animations, animIndex, autoRotate, background = null, onCanvas }: Viewer3DProps) {
  const hasClips = animations.length > 0;
  // lift ambient on light backdrops so the model never reads murky
  const lightBg = background != null;
  return (
    <Canvas
      shadows
      dpr={[2, 3]}
      camera={{ position: [0, 1.2, 6], fov: 38 }}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        onCanvas?.(gl.domElement);
      }}
    >
      <SceneBackground color={background} />
      <ambientLight intensity={lightBg ? 0.85 : 0.45} />
      <directionalLight
        position={[4, 6, 4]}
        intensity={2.4}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
      >
        <orthographicCamera attach="shadow-camera" args={[-4, 4, 4, -4, 0.5, 25]} />
      </directionalLight>
      <directionalLight position={[-4, 3, -3.5]} intensity={1.2} color="#6a8cff" />
      <directionalLight position={[-2, -1, 3]} intensity={0.5} color="#ff8a4d" />

      <Suspense fallback={null}>
        <Model object={object} animations={animations} animIndex={animIndex} playing={hasClips} />
      </Suspense>
      <FitCamera object={object} animations={animations} />

      <ContactShadows position={[0, 0.01, 0]} opacity={0.5} scale={12} blur={2.4} far={6} resolution={1024} color="#000000" />
      <OrbitControls makeDefault enableDamping dampingFactor={0.07} autoRotate={autoRotate || !hasClips} autoRotateSpeed={1.1} />
    </Canvas>
  );
}
