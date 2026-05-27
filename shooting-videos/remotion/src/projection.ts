/**
 * Project 3D world coordinates to 2D screen space using an explicit camera state.
 * Shared by ContactFreezePoc and Grounded A4 contact overlay.
 */
import * as THREE from "three";

export type CameraState = {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
};

export function projectScreen(
  world: THREE.Vector3,
  cam: CameraState,
  width: number,
  height: number,
): {x: number; y: number; visible: boolean} {
  const camObj = new THREE.PerspectiveCamera(cam.fov, width / height, 0.1, 100);
  camObj.position.copy(cam.position);
  camObj.lookAt(cam.target);
  camObj.updateMatrixWorld(true);
  camObj.updateProjectionMatrix();
  const v = world.clone().project(camObj);
  return {
    x: (v.x * 0.5 + 0.5) * width,
    y: (1 - (v.y * 0.5 + 0.5)) * height,
    visible: v.z > -1 && v.z < 1 && Math.abs(v.x) < 2 && Math.abs(v.y) < 2,
  };
}
