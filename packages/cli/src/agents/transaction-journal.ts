import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';

export interface TransactionRecord {
  id: string;
  timestamp: string;
  workspace: string;
  action: 'write' | 'trash' | 'restore';
  target: string;
  beforeSha256: string | null;
  afterSha256?: string;
  backupPath?: string;
  status: 'prepared' | 'complete';
  restoresTransactionId?: string;
}

export function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function stateRoot(): string {
  return process.env.SKYCODE_TRANSACTION_ROOT || join(homedir(), '.skycode', 'transactions');
}

function workspaceId(workspace: string): string {
  return sha256(resolve(workspace)).slice(0, 24);
}

async function appendRecord(workspace: string, record: TransactionRecord): Promise<void> {
  const root = join(stateRoot(), workspaceId(workspace));
  await mkdir(root, { recursive: true, mode: 0o700 });
  await appendFile(join(root, 'journal.jsonl'), JSON.stringify(record) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  });
}

export async function prepareFileWrite(
  workspace: string,
  target: string,
  before: Buffer | null
): Promise<TransactionRecord> {
  const id = randomUUID();
  const root = join(stateRoot(), workspaceId(workspace));
  const backupPath = before ? join(root, 'backups', id + '.bin') : undefined;
  if (backupPath && before) {
    await mkdir(join(root, 'backups'), { recursive: true, mode: 0o700 });
    await writeFile(backupPath, before, { mode: 0o600 });
  }
  const record: TransactionRecord = {
    id,
    timestamp: new Date().toISOString(),
    workspace: resolve(workspace),
    action: 'write',
    target: resolve(target),
    beforeSha256: before ? sha256(before) : null,
    backupPath,
    status: 'prepared',
  };
  await appendRecord(workspace, record);
  return record;
}

export async function completeFileWrite(
  workspace: string,
  prepared: TransactionRecord,
  after: string
): Promise<void> {
  await appendRecord(workspace, {
    ...prepared,
    timestamp: new Date().toISOString(),
    afterSha256: sha256(after),
    status: 'complete',
  });
}

export async function moveToTransactionTrash(
  workspace: string,
  target: string
): Promise<TransactionRecord> {
  const id = randomUUID();
  const root = join(stateRoot(), workspaceId(workspace));
  const trashPath = join(root, 'trash', id + '-' + basename(target));
  await mkdir(join(root, 'trash'), { recursive: true, mode: 0o700 });
  const info = await stat(target);
  const before = info.isFile() ? await readFile(target) : null;
  await rename(target, trashPath);
  const record: TransactionRecord = {
    id,
    timestamp: new Date().toISOString(),
    workspace: resolve(workspace),
    action: 'trash',
    target: resolve(target),
    beforeSha256: before ? sha256(before) : null,
    backupPath: trashPath,
    status: 'complete',
  };
  await appendRecord(workspace, record);
  return record;
}

function isInside(parent: string, candidate: string): boolean {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export async function restoreTransaction(
  workspace: string,
  transactionId: string
): Promise<TransactionRecord> {
  const resolvedWorkspace = resolve(workspace);
  const root = join(stateRoot(), workspaceId(workspace));
  const journal = await readFile(join(root, 'journal.jsonl'), 'utf8');
  const records = journal
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TransactionRecord);
  const original = [...records].reverse().find(
    (record) => record.id === transactionId && record.status === 'complete'
  );
  if (!original || (original.action !== 'write' && original.action !== 'trash')) {
    throw new Error('Completed transaction not found: ' + transactionId);
  }
  if (resolve(original.workspace) !== resolvedWorkspace || !isInside(resolvedWorkspace, original.target)) {
    throw new Error('Transaction does not belong to the active workspace.');
  }
  if (original.backupPath && !isInside(root, original.backupPath)) {
    throw new Error('Transaction backup path escaped the recovery store.');
  }

  const targetExists = await stat(original.target).then(() => true).catch(() => false);
  if (original.action === 'trash') {
    if (targetExists) throw new Error('Restore target already exists; refusing to overwrite it.');
    if (!original.backupPath) throw new Error('Transaction has no recovery payload.');
    await rename(original.backupPath, original.target);
  } else {
    if (!targetExists) throw new Error('Written file is missing; refusing an ambiguous rollback.');
    const current = await readFile(original.target);
    if (original.afterSha256 && sha256(current) !== original.afterSha256) {
      throw new Error('File changed after the transaction; refusing a stale rollback.');
    }
    await moveToTransactionTrash(workspace, original.target);
    if (original.beforeSha256 !== null) {
      if (!original.backupPath) throw new Error('Transaction has no pre-write backup.');
      await rename(original.backupPath, original.target);
    }
  }

  const restored: TransactionRecord = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    workspace: resolvedWorkspace,
    action: 'restore',
    target: original.target,
    beforeSha256: original.afterSha256 || original.beforeSha256,
    status: 'complete',
    restoresTransactionId: original.id,
  };
  await appendRecord(workspace, restored);
  return restored;
}
