import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export function emergencyStopPath(): string {
  return process.env.SKYCODE_EMERGENCY_STOP_PATH || join(homedir(), '.skycode', 'EMERGENCY_STOP');
}

export function emergencyStopActive(): boolean {
  return existsSync(emergencyStopPath());
}

export function assertSafetyEnabled(): void {
  if (emergencyStopActive()) {
    throw new Error('SkyCode emergency stop is active. No tool, network, process, or filesystem action may run.');
  }
}

export function activateEmergencyStop(reason = 'Activated by local operator.'): void {
  const path = emergencyStopPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, reason + '\n', { encoding: 'utf8', mode: 0o600 });
}

export function clearEmergencyStop(): void {
  const path = emergencyStopPath();
  if (existsSync(path)) unlinkSync(path);
}
