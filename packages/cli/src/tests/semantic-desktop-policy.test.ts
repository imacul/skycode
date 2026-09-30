import { describe, expect, test } from 'bun:test';
import { authorizeSemanticAction, type DesktopSnapshot } from '../agents/semantic-desktop-policy';

const snapshot: DesktopSnapshot = {
  adapter: 'windows-uia', windowId: '42', processId: 123, processName: 'POWERPNT.EXE',
  title: 'Quarterly deck', focused: true,
  nodes: [{ id: 'save', role: 'button', name: 'Save', enabled: true }],
};

describe('semantic desktop policy', () => {
  test('requires stable focused window identity and a live typed node', () => {
    expect(authorizeSemanticAction(snapshot, {
      kind: 'invoke', windowId: '42', processId: 123, nodeId: 'save', expectedTitle: 'Quarterly deck',
    }).role).toBe('button');
    expect(() => authorizeSemanticAction({ ...snapshot, focused: false }, {
      kind: 'invoke', windowId: '42', processId: 123, nodeId: 'save', expectedTitle: 'Quarterly deck',
    })).toThrow(/not focused/);
  });

  test('blocks secure desktops, password managers, auth controls, and origin changes', () => {
    const action = { kind: 'invoke' as const, windowId: '42', processId: 123, nodeId: 'save', expectedTitle: 'Quarterly deck' };
    expect(() => authorizeSemanticAction({ ...snapshot, secureDesktop: true }, action)).toThrow(/Secure desktop/);
    expect(() => authorizeSemanticAction({ ...snapshot, processName: 'Bitwarden.exe' }, action)).toThrow(/password-manager/);
    expect(() => authorizeSemanticAction({ ...snapshot, nodes: [{ ...snapshot.nodes[0], password: true }] }, action)).toThrow(/Credential/);
    expect(() => authorizeSemanticAction({ ...snapshot, nodes: [{ ...snapshot.nodes[0], origin: 'https://evil.test' }] }, {
      ...action, expectedOrigin: 'https://music.youtube.com',
    })).toThrow(/origin changed/);
  });
});
