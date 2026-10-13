/** Vibração dos controles WebXR, com limite de taxa para não saturar o atuador do Quest. */
type Pulser = { pulse?: (intensity: number, ms: number) => Promise<boolean> };
type DualRumble = {
  playEffect?: (type: string, params: { duration: number; strongMagnitude: number; weakMagnitude: number; startDelay?: number }) => Promise<unknown>;
};

const lastPulse = new WeakMap<Gamepad, number>();

export function pulse(gamepad: Gamepad | undefined | null, intensity: number, ms: number): void {
  if (!gamepad || intensity <= 0.01) return;
  const now = performance.now();
  const last = lastPulse.get(gamepad) ?? 0;
  if (now - last < Math.min(ms, 40)) return;
  lastPulse.set(gamepad, now);
  const k = Math.max(0, Math.min(1, intensity));
  const actuators = (gamepad as unknown as { hapticActuators?: Pulser[] }).hapticActuators;
  const a = actuators?.[0];
  if (a?.pulse) {
    a.pulse(k, ms).catch(() => {});
    return;
  }
  const v = (gamepad as unknown as { vibrationActuator?: DualRumble }).vibrationActuator;
  v?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: k, weakMagnitude: k * 0.7 })?.catch?.(() => {});
}
