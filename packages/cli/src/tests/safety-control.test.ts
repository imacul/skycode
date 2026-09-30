import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { activateEmergencyStop, assertSafetyEnabled, clearEmergencyStop, emergencyStopActive } from '../security/safety-control';

process.env.SKYCODE_EMERGENCY_STOP_PATH = join(tmpdir(), `skycode-stop-${process.pid}.flag`);

afterEach(() => clearEmergencyStop());

describe('broker-level emergency stop', () => {
  test('denies actions while the durable local stop marker exists', () => {
    clearEmergencyStop();
    expect(emergencyStopActive()).toBe(false);
    activateEmergencyStop('test');
    expect(emergencyStopActive()).toBe(true);
    expect(() => assertSafetyEnabled()).toThrow('emergency stop');
  });

  test('requires an explicit local clear before actions resume', () => {
    activateEmergencyStop('test');
    clearEmergencyStop();
    expect(() => assertSafetyEnabled()).not.toThrow();
  });
});
