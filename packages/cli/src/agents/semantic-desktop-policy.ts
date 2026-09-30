export type SemanticRole =
  | 'window' | 'button' | 'link' | 'textbox' | 'checkbox' | 'menuitem'
  | 'listitem' | 'document' | 'image' | 'unknown';

export interface SemanticNode {
  id: string;
  role: SemanticRole;
  name: string;
  enabled: boolean;
  focused?: boolean;
  password?: boolean;
  origin?: string;
}

export interface DesktopSnapshot {
  adapter: 'windows-uia' | 'macos-accessibility' | 'linux-at-spi';
  windowId: string;
  processId: number;
  processName: string;
  title: string;
  focused: boolean;
  secureDesktop?: boolean;
  nodes: SemanticNode[];
}

export interface SemanticAction {
  kind: 'invoke' | 'focus' | 'set-value' | 'read';
  windowId: string;
  processId: number;
  nodeId: string;
  expectedTitle: string;
  expectedOrigin?: string;
}

const PROTECTED_PROCESSES = /^(?:logonui|credentialuibroker|consent|1password|bitwarden|keepass|keepassxc|lastpass)$/i;
const PROTECTED_TEXT = /\b(password|passcode|pin|one[- ]?time code|2fa|authenticator|recovery phrase|seed phrase|private key|sign in|log in|unlock)\b/i;

export function authorizeSemanticAction(snapshot: DesktopSnapshot, action: SemanticAction): SemanticNode {
  if (snapshot.secureDesktop) throw new Error('Secure desktop control is prohibited.');
  if (PROTECTED_PROCESSES.test(snapshot.processName.replace(/\.exe$/i, ''))) {
    throw new Error('Authentication and password-manager surfaces are prohibited.');
  }
  if (!snapshot.focused) throw new Error('Target window is not focused.');
  if (snapshot.windowId !== action.windowId || snapshot.processId !== action.processId) {
    throw new Error('Window identity changed before the action.');
  }
  if (snapshot.title !== action.expectedTitle) {
    throw new Error('Window title changed before the action.');
  }
  const node = snapshot.nodes.find((candidate) => candidate.id === action.nodeId);
  if (!node) throw new Error('Semantic target no longer exists.');
  if (!node.enabled) throw new Error('Semantic target is disabled.');
  if (node.password || PROTECTED_TEXT.test(node.name)) {
    throw new Error('Credential and authentication controls are prohibited.');
  }
  if (action.expectedOrigin && node.origin !== action.expectedOrigin) {
    throw new Error('Browser origin changed before the action.');
  }
  return node;
}
