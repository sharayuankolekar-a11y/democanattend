// Timeline for the screen-light ("face flashing") check.
//
// The colour on screen is a pure function of elapsed time since the check started, so a slow frame,
// a slow JPEG encode or a late timer can never push later steps out of step with the server.
// (The first version used one timer per step; each step ran a little long, the error accumulated,
// and by the last colours the server was comparing the face against the wrong colours.)
//
// The server assumes: colour k is switched on at k * stepMs and is visible in camera frames from about
// k * stepMs + latencyMs. Frames are reported with t = ms since colour 0 was switched on.

export interface LightPlan {
  colors: number[][];
  stepMs: number;
  latencyMs: number;
  captureEveryMs: number;
}

export const lightTotalMs = (p: LightPlan): number => p.colors.length * p.stepMs + p.latencyMs;

/** Which colour should be on screen at elapsedMs (-1 = none, i.e. the dark background). */
export const colorIndexAt = (elapsedMs: number, p: LightPlan): number => {
  if (elapsedMs < 0) return -1;
  const i = Math.floor(elapsedMs / p.stepMs);
  return i < p.colors.length ? i : -1;
};

export interface LightTick {
  colorIndex: number;
  capture: boolean;
  done: boolean;
}

export const NEVER_CAPTURED = -1e9;

export const lightTick = (elapsedMs: number, lastCaptureMs: number, p: LightPlan): LightTick => ({
  colorIndex: colorIndexAt(elapsedMs, p),
  capture: elapsedMs <= lightTotalMs(p) && elapsedMs - lastCaptureMs >= p.captureEveryMs,
  done: elapsedMs >= lightTotalMs(p),
});

export const rgbCss = (c: number[]): string => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
