import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CREDENTIAL_DIRECTORY =
  process.env.SKYCODE_CREDENTIALS_PATH || join(homedir(), '.skycode', 'credentials');

function credentialPath(name: string): string {
  if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error('Invalid credential name.');
  return join(CREDENTIAL_DIRECTORY, name + '.dpapi');
}

function runPowerShell(script: string, input = ''): string | null {
  const result = spawnSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    {
      input,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
      env: {
        SystemRoot: process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows',
        PATH: process.env.PATH || process.env.Path || '',
      },
    }
  );
  return result.status === 0 ? result.stdout.trim() : null;
}

function commandExists(command: string, args: string[]): boolean {
  const result = spawnSync(command, args, { stdio: 'ignore', windowsHide: true, timeout: 3_000 });
  return result.status === 0;
}

function secretToolAvailable(): boolean {
  return process.platform === 'linux' && commandExists('secret-tool', ['--version']);
}

function macKeychainAvailable(): boolean {
  return process.platform === 'darwin' && commandExists('/usr/bin/swift', ['--version']);
}

function runMacKeychain(operation: 'write' | 'read' | 'delete', name: string, input = ''): string | null {
  // The secret is sent over stdin to a native Security.framework call. It is
  // never placed in argv, an environment variable, a script file, or stdout.
  const source = `
import Foundation
import Security
let operation = CommandLine.arguments[1]
let account = CommandLine.arguments[2]
let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
  kSecAttrService as String: "SkyCode", kSecAttrAccount as String: account]
if operation == "write" {
  let data = FileHandle.standardInput.readDataToEndOfFile()
  SecItemDelete(base as CFDictionary)
  var item = base
  item[kSecValueData as String] = data
  exit(SecItemAdd(item as CFDictionary, nil) == errSecSuccess ? 0 : 1)
} else if operation == "read" {
  var query = base
  query[kSecReturnData as String] = true
  query[kSecMatchLimit as String] = kSecMatchLimitOne
  var result: CFTypeRef?
  guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
        let data = result as? Data else { exit(1) }
  FileHandle.standardOutput.write(data)
} else {
  let status = SecItemDelete(base as CFDictionary)
  exit(status == errSecSuccess || status == errSecItemNotFound ? 0 : 1)
}`;
  const result = spawnSync('/usr/bin/swift', ['-e', source, '--', operation, name], {
    input,
    encoding: 'utf8',
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
    env: { PATH: '/usr/bin:/bin' },
  });
  return result.status === 0 ? result.stdout : null;
}

function runSecretTool(args: string[], input = ''): string | null {
  const result = spawnSync('secret-tool', args, {
    input,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    env: { PATH: process.env.PATH || '' },
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function secureCredentialStoreAvailable(): boolean {
  return process.platform === 'win32' || secretToolAvailable() || macKeychainAvailable();
}

export function writeSecureCredential(name: string, secret: string): boolean {
  if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error('Invalid credential name.');
  if (secretToolAvailable()) {
    return runSecretTool(
      ['store', '--label=SkyCode ' + name, 'application', 'skycode', 'credential', name],
      secret
    ) !== null;
  }
  if (macKeychainAvailable()) return runMacKeychain('write', name, secret) !== null;
  if (process.platform !== 'win32') return false;
  const encrypted = runPowerShell(
    'Add-Type -AssemblyName System.Security;' +
      "$value=[Console]::In.ReadToEnd();" +
      "$bytes=[Text.Encoding]::UTF8.GetBytes($value);" +
      "$protected=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);" +
      "$roundtrip=[Security.Cryptography.ProtectedData]::Unprotect($protected,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);" +
      "if ([Text.Encoding]::UTF8.GetString($roundtrip) -cne $value) { exit 1 };" +
      '[Convert]::ToBase64String($protected)',
    secret
  );
  if (!encrypted) return false;
  mkdirSync(CREDENTIAL_DIRECTORY, { recursive: true, mode: 0o700 });
  const target = credentialPath(name);
  const temporary = target + '.' + process.pid + '.tmp';
  writeFileSync(temporary, encrypted + '\n', { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, target);
  return true;
}

/** Store a credential and prove the OS vault can return the exact value. */
export function writeSecureCredentialVerified(name: string, secret: string): boolean {
  // The Windows write performs protect+unprotect verification before atomically
  // replacing the ciphertext file, so no second PowerShell process is needed.
  if (process.platform === 'win32') return writeSecureCredential(name, secret);
  const previous = readSecureCredential(name);
  if (!writeSecureCredential(name, secret)) return false;
  if (readSecureCredential(name) === secret) return true;
  // Best-effort rollback protects a working credential from a failed rotation.
  if (previous) writeSecureCredential(name, previous);
  else deleteSecureCredential(name);
  return false;
}

export function readSecureCredential(name: string): string {
  if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error('Invalid credential name.');
  if (secretToolAvailable()) {
    return runSecretTool(['lookup', 'application', 'skycode', 'credential', name]) || '';
  }
  if (macKeychainAvailable()) return runMacKeychain('read', name) || '';
  if (process.platform !== 'win32') return '';
  const path = credentialPath(name);
  if (!existsSync(path)) return '';
  const encrypted = readFileSync(path, 'utf8').trim();
  if (!encrypted) return '';
  return (
    runPowerShell(
      'Add-Type -AssemblyName System.Security;' +
        "$protected=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim());" +
        "$bytes=[Security.Cryptography.ProtectedData]::Unprotect($protected,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);" +
        '[Text.Encoding]::UTF8.GetString($bytes)',
      encrypted
    ) || ''
  );
}

export function deleteSecureCredential(name: string): void {
  if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error('Invalid credential name.');
  if (secretToolAvailable()) {
    runSecretTool(['clear', 'application', 'skycode', 'credential', name]);
    return;
  }
  if (macKeychainAvailable()) {
    runMacKeychain('delete', name);
    return;
  }
  if (process.platform !== 'win32') return;
  const path = credentialPath(name);
  if (existsSync(path)) unlinkSync(path);
}
