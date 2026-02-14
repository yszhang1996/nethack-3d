export type CameraMotionStateSnapshot = {
  tileSize: number;
  playerX: number;
  playerY: number;
  cameraDistance: number;
  cameraPitch: number;
  cameraYaw: number;
  cameraPanX: number;
  cameraPanY: number;
  cameraPanTargetX: number;
  cameraPanTargetY: number;
  isCameraCenteredOnPlayer: boolean;
  cameraRecenteringInProgress: boolean;
  cameraPanHalfLifeMs: number;
  cameraFollowHalfLifeMs: number;
  cameraRecenterFollowHalfLifeMs: number;
  cameraFollowInitialized: boolean;
  cameraFollowCurrentX: number;
  cameraFollowCurrentY: number;
};

export type CameraMotionPose = {
  cameraX: number;
  cameraY: number;
  cameraZ: number;
  lookAtX: number;
  lookAtY: number;
  cameraPanX: number;
  cameraPanY: number;
  cameraRecenteringInProgress: boolean;
  cameraFollowInitialized: boolean;
  cameraFollowCurrentX: number;
  cameraFollowCurrentY: number;
};

export type CameraMotionWorkerCommand =
  | { type: "sync_state"; state: CameraMotionStateSnapshot }
  | { type: "shutdown" };

export type CameraMotionWorkerEnvelope = { type: "pose"; pose: CameraMotionPose };
