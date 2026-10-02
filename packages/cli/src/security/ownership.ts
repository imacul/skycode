export type OwnershipMode = 'safe' | 'owner';

export interface OwnershipSettings {
  mode: OwnershipMode;
  autoApprove: boolean;
  allowSystemCommands: boolean;
  allowAbsolutePaths: boolean;
  allowShellFeatures: boolean;
  allowArbitraryDesktopApps: boolean;
  leaseTtlHours: number;
  enabledAt?: string;
  enabledBy?: string;
}

export const DEFAULT_OWNERSHIP: OwnershipSettings = {
  mode: 'safe',
  autoApprove: false,
  allowSystemCommands: false,
  allowAbsolutePaths: false,
  allowShellFeatures: false,
  allowArbitraryDesktopApps: false,
  leaseTtlHours: 24,
};

export function normalizeOwnershipSettings(
  value: Partial<OwnershipSettings> | undefined | null
): OwnershipSettings {
  const merged: OwnershipSettings = {
    ...DEFAULT_OWNERSHIP,
    ...(value || {}),
  };
  if (merged.mode !== 'owner' && merged.mode !== 'safe') {
    merged.mode = 'safe';
  }
  merged.leaseTtlHours = Math.max(1, Math.min(Number(merged.leaseTtlHours) || 24, 24 * 30));
  return merged;
}

export function isOwnerMode(ownership?: Partial<OwnershipSettings> | null): boolean {
  return normalizeOwnershipSettings(ownership).mode === 'owner';
}

export function ownerModeEnabled(ownership?: Partial<OwnershipSettings> | null): boolean {
  return isOwnerMode(ownership);
}

export function createOwnerSettings(
  partial: Partial<OwnershipSettings> = {}
): OwnershipSettings {
  return normalizeOwnershipSettings({
    mode: 'owner',
    autoApprove: true,
    allowSystemCommands: true,
    allowAbsolutePaths: true,
    allowShellFeatures: true,
    allowArbitraryDesktopApps: true,
    leaseTtlHours: 168,
    enabledAt: new Date().toISOString(),
    enabledBy: 'local-operator',
    ...partial,
  });
}

export function createSafeOwnershipSettings(): OwnershipSettings {
  return normalizeOwnershipSettings({
    mode: 'safe',
    autoApprove: false,
    allowSystemCommands: false,
    allowAbsolutePaths: false,
    allowShellFeatures: false,
    allowArbitraryDesktopApps: false,
    leaseTtlHours: 24,
    enabledAt: undefined,
    enabledBy: undefined,
  });
}

export function describeOwnership(ownership?: Partial<OwnershipSettings> | null): string {
  const o = normalizeOwnershipSettings(ownership);
  if (o.mode !== 'owner') {
    return [
      'Ownership mode: safe (default)',
      'Approvals required for workspace-changing commands.',
      'System/destructive commands, absolute paths, and shell chaining stay blocked.',
      'Use /owner on to grant PC-level control as your Windows user.',
    ].join('\n');
  }
  return [
    'Ownership mode: OWNER',
    'autoApprove: ' + String(o.autoApprove),
    'allowSystemCommands: ' + String(o.allowSystemCommands),
    'allowAbsolutePaths: ' + String(o.allowAbsolutePaths),
    'allowShellFeatures: ' + String(o.allowShellFeatures),
    'allowArbitraryDesktopApps: ' + String(o.allowArbitraryDesktopApps),
    'leaseTtlHours: ' + String(o.leaseTtlHours),
    o.enabledAt ? 'enabledAt: ' + o.enabledAt : '',
    'Emergency stop file (~/.skycode/EMERGENCY_STOP) still blocks every tool.',
    'Runs as your user account — Admin/UAC elevation still needs Windows consent.',
  ]
    .filter(Boolean)
    .join('\n');
}
