export interface ReelMotion {
  strip: string[];
  startTime: number;
  duration: number;
  startPosition: number;
  targetPosition: number;
  distance: number;
  entryVelocity: number;
}

export interface ReelMotionSample { position: number; velocity: number; complete: boolean; }

export function sampleReelMotion(motion: ReelMotion, now: number): ReelMotionSample {
  const progress = Math.min(1, Math.max(0, (now - motion.startTime) / motion.duration)); const squared = progress * progress; const cubed = squared * progress;
  const velocityDistance = motion.entryVelocity * motion.duration;
  const position = motion.startPosition + (cubed - 2 * squared + progress) * velocityDistance + (-2 * cubed + 3 * squared) * motion.distance;
  const derivative = (3 * squared - 4 * progress + 1) * velocityDistance + (-6 * squared + 6 * progress) * motion.distance;
  return { position: progress >= 1 ? motion.targetPosition : position, velocity: progress >= 1 ? 0 : Math.max(0, derivative / motion.duration), complete: progress >= 1 };
}
