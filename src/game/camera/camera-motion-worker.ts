import type {
  CameraMotionPose,
  CameraMotionStateSnapshot,
  CameraMotionWorkerCommand,
  CameraMotionWorkerEnvelope,
} from "./types";

let state: CameraMotionStateSnapshot | null = null;
let loopTimerId: number | null = null;
let lastTickAtMs: number = 0;
let nextTickAtMs: number = 0;
let lastPose: CameraMotionPose | null = null;
const targetTickRateHz = 120;
const tickIntervalMs = 1000 / targetTickRateHz;

function postEnvelope(envelope: CameraMotionWorkerEnvelope): void {
  (self as unknown as Worker).postMessage(envelope);
}

function clampDeltaSeconds(rawDeltaMs: number): number {
  return Math.max(0, Math.min(rawDeltaMs, 250)) / 1000;
}

function lerp(start: number, end: number, alpha: number): number {
  return start + (end - start) * alpha;
}

function computeHalfLifeAlpha(deltaSeconds: number, halfLifeMs: number): number {
  if (halfLifeMs <= 0) {
    return 1;
  }
  return 1 - Math.exp((-Math.LN2 * deltaSeconds * 1000) / halfLifeMs);
}

function buildPose(currentState: CameraMotionStateSnapshot): CameraMotionPose {
  const followX = currentState.cameraFollowCurrentX;
  const followY = currentState.cameraFollowCurrentY;

  const cosPitch = Math.cos(currentState.cameraPitch);
  const sinPitch = Math.sin(currentState.cameraPitch);
  const sinYaw = Math.sin(currentState.cameraYaw);
  const cosYaw = Math.cos(currentState.cameraYaw);

  const offsetX = currentState.cameraDistance * cosPitch * sinYaw;
  const offsetY = currentState.cameraDistance * cosPitch * cosYaw;
  const offsetZ = currentState.cameraDistance * sinPitch;

  return {
    cameraX: followX + offsetX,
    cameraY: followY + offsetY,
    cameraZ: offsetZ,
    lookAtX: followX,
    lookAtY: followY,
    cameraPanX: currentState.cameraPanX,
    cameraPanY: currentState.cameraPanY,
    cameraRecenteringInProgress: currentState.cameraRecenteringInProgress,
    cameraFollowInitialized: currentState.cameraFollowInitialized,
    cameraFollowCurrentX: currentState.cameraFollowCurrentX,
    cameraFollowCurrentY: currentState.cameraFollowCurrentY,
  };
}

function hasPoseChanged(
  prev: CameraMotionPose | null,
  next: CameraMotionPose,
): boolean {
  if (!prev) {
    return true;
  }
  const epsilon = 0.0001;
  if (Math.abs(prev.cameraX - next.cameraX) > epsilon) return true;
  if (Math.abs(prev.cameraY - next.cameraY) > epsilon) return true;
  if (Math.abs(prev.cameraZ - next.cameraZ) > epsilon) return true;
  if (Math.abs(prev.lookAtX - next.lookAtX) > epsilon) return true;
  if (Math.abs(prev.lookAtY - next.lookAtY) > epsilon) return true;
  if (Math.abs(prev.cameraPanX - next.cameraPanX) > epsilon) return true;
  if (Math.abs(prev.cameraPanY - next.cameraPanY) > epsilon) return true;
  if (
    prev.cameraRecenteringInProgress !== next.cameraRecenteringInProgress
  )
    return true;
  if (prev.cameraFollowInitialized !== next.cameraFollowInitialized) return true;
  return false;
}

function stepMotion(currentState: CameraMotionStateSnapshot, deltaSeconds: number): void {
  const panAlpha = computeHalfLifeAlpha(deltaSeconds, currentState.cameraPanHalfLifeMs);
  currentState.cameraPanX = lerp(
    currentState.cameraPanX,
    currentState.cameraPanTargetX,
    panAlpha,
  );
  currentState.cameraPanY = lerp(
    currentState.cameraPanY,
    currentState.cameraPanTargetY,
    panAlpha,
  );

  const panX = currentState.isCameraCenteredOnPlayer
    ? currentState.cameraPanTargetX
    : currentState.cameraPanX;
  const panY = currentState.isCameraCenteredOnPlayer
    ? currentState.cameraPanTargetY
    : currentState.cameraPanY;
  const targetX = currentState.playerX * currentState.tileSize + panX;
  const targetY = -currentState.playerY * currentState.tileSize + panY;

  if (!currentState.cameraFollowInitialized) {
    currentState.cameraFollowCurrentX = targetX;
    currentState.cameraFollowCurrentY = targetY;
    currentState.cameraFollowInitialized = true;
    currentState.cameraRecenteringInProgress = false;
    return;
  }

  const followHalfLifeMs = currentState.cameraRecenteringInProgress
    ? currentState.cameraRecenterFollowHalfLifeMs
    : currentState.cameraFollowHalfLifeMs;
  const followAlpha = computeHalfLifeAlpha(deltaSeconds, followHalfLifeMs);
  currentState.cameraFollowCurrentX = lerp(
    currentState.cameraFollowCurrentX,
    targetX,
    followAlpha,
  );
  currentState.cameraFollowCurrentY = lerp(
    currentState.cameraFollowCurrentY,
    targetY,
    followAlpha,
  );

  if (
    currentState.cameraRecenteringInProgress &&
    Math.abs(targetX - currentState.cameraFollowCurrentX) < 0.02 &&
    Math.abs(targetY - currentState.cameraFollowCurrentY) < 0.02
  ) {
    currentState.cameraRecenteringInProgress = false;
  }
}

function flushPose(): void {
  if (!state) {
    return;
  }
  const pose = buildPose(state);
  if (!hasPoseChanged(lastPose, pose)) {
    return;
  }
  lastPose = pose;
  postEnvelope({
    type: "pose",
    pose,
  });
}

function tick(): void {
  if (!state) {
    return;
  }
  const now = performance.now();
  const rawDeltaMs = lastTickAtMs > 0 ? now - lastTickAtMs : tickIntervalMs;
  lastTickAtMs = now;
  const deltaSeconds = clampDeltaSeconds(rawDeltaMs);
  stepMotion(state, deltaSeconds);
  flushPose();
}

function startLoop(): void {
  if (loopTimerId !== null) {
    return;
  }
  lastTickAtMs = performance.now();
  nextTickAtMs = lastTickAtMs + tickIntervalMs;
  loopTimerId = setTimeout(runLoop, tickIntervalMs) as unknown as number;
}

function stopLoop(): void {
  if (loopTimerId !== null) {
    clearTimeout(loopTimerId);
    loopTimerId = null;
  }
  lastTickAtMs = 0;
  nextTickAtMs = 0;
}

function runLoop(): void {
  loopTimerId = null;
  tick();
  if (!state) {
    return;
  }

  const now = performance.now();
  if (nextTickAtMs <= 0 || now - nextTickAtMs > tickIntervalMs) {
    nextTickAtMs = now;
  }
  nextTickAtMs += tickIntervalMs;
  const delayMs = Math.max(0, nextTickAtMs - now);
  loopTimerId = setTimeout(runLoop, delayMs) as unknown as number;
}

self.onmessage = (message: MessageEvent<CameraMotionWorkerCommand>) => {
  const command = message.data;
  switch (command.type) {
    case "sync_state":
      if (state) {
        const nextState = {
          ...command.state,
        };
        if (state.cameraFollowInitialized && nextState.cameraFollowInitialized) {
          // Preserve in-flight follow integration to avoid jitter from stale main-thread snapshots.
          nextState.cameraFollowCurrentX = state.cameraFollowCurrentX;
          nextState.cameraFollowCurrentY = state.cameraFollowCurrentY;
        }
        state = nextState;
      } else {
        state = {
          ...command.state,
        };
        lastPose = null;
      }
      startLoop();
      if (state && !state.cameraFollowInitialized) {
        stepMotion(state, 0);
      }
      flushPose();
      return;
    case "shutdown":
      state = null;
      lastPose = null;
      stopLoop();
      return;
    default:
      return;
  }
};
