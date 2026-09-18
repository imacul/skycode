import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createLocalLLMProvider } from '../providers/local';
import { useSettingsStore } from '../store/settings';
import { getSystemMessage, type Message } from '../store/conversation';
import { createContextBudget, fitHistoryToBudget } from '../utils/context-window';
import { SkyCodeAgentOrchestrator } from '../agents/orchestrator';
import { EVAL_CASES, SMOKE_CASES } from './cases';
import type { EvalCase, EvalResult, EvalStatus, EvalValidator } from './types';

function validateResponse(response: string, validator?: EvalValidator): { status: EvalStatus; expected?: string } {
  if (!validator) return { status: 'REVIEW', expected: 'No validator configured.' };
  const raw = response.trim();

  switch (validator.type) {
    case 'exact': {
      const actual = validator.caseSensitive === false ? raw.toLowerCase() : raw;
      const expected = validator.caseSensitive === false ? validator.value.toLowerCase() : validator.value;
      return { status: actual === expected ? 'PASS' : 'FAIL', expected: 'exact: ' + validator.value };
    }
    case 'contains': {
      const actual = validator.caseSensitive === false ? raw.toLowerCase() : raw;
      const value = validator.caseSensitive === false ? validator.value.toLowerCase() : validator.value;
      return { status: actual.includes(value) ? 'PASS' : 'FAIL', expected: 'contains: ' + validator.value };
    }
    case 'not_contains': {
      const actual = validator.caseSensitive === false ? raw.toLowerCase() : raw;
      const values = validator.caseSensitive === false ? validator.values.map((v) => v.toLowerCase()) : validator.values;
      return {
        status: values.some((value) => actual.includes(value)) ? 'FAIL' : 'PASS',
        expected: 'must not contain: ' + validator.values.join(', '),
      };
    }
    case 'regex':
      return {
        status: new RegExp(validator.pattern, validator.flags).test(raw) ? 'PASS' : 'FAIL',
        expected: 'regex: /' + validator.pattern + '/' + (validator.flags || ''),
      };
    case 'json':
      try {
        JSON.parse(raw);
        return { status: 'PASS', expected: 'valid JSON only' };
      } catch {
        return { status: 'FAIL', expected: 'valid JSON only' };
      }
    case 'review':
      return { status: 'REVIEW', expected: validator.note };
  }
}

async function runRoutingCase(test: EvalCase): Promise<EvalResult> {
  const started = Date.now();
  const orchestrator = new SkyCodeAgentOrchestrator();

  if (test.id === 92) {
    const first = orchestrator.explainRoute({ input: 'Write a TypeScript debounce function.' });
    (orchestrator as any).lastRouteDecision = first;
  }

  const request = test.id === 91
    ? { input: test.prompt || '', context: { agent: 'business-agent' } }
    : { input: test.prompt || '' };

  const decision = orchestrator.explainRoute(request as any);
  const expected = test.routeExpected || [];
  return {
    id: test.id,
    name: test.name,
    category: test.category,
    status: expected.includes(decision.agentName) ? 'PASS' : 'FAIL',
    prompt: test.prompt || '',
    response: decision.reason,
    route: decision.agentName,
    expected: expected.join(' or '),
    durationMs: Date.now() - started,
  };
}

async function createLocalEvalProvider() {
  const provider = createLocalLLMProvider();
  const state = useSettingsStore.getState();
  const local = state.providers.local;

  await provider.initialize({
    baseUrl: process.env.LOCAL_LLM_BASE_URL || local.baseUrl || 'http://localhost:11434',
    model: process.env.LOCAL_LLM_MODEL,
    enableThinking: false,
  });

  const models = await provider.listModels();
  const preferred = process.env.LOCAL_LLM_MODEL || state.model.defaultModel;
  const model = models.find((candidate) => candidate.id === preferred)?.id || preferred || models[0]?.id;
  if (!model) throw new Error('No local model is available for evaluation.');

  const modelInfo = await provider.getModel(model);
  const explicitContext = Number(process.env.LOCAL_LLM_CONTEXT_LENGTH || process.env.SKYCODE_CONTEXT_LENGTH || '');
  const contextWindow = Number.isFinite(explicitContext) && explicitContext > 0
    ? explicitContext
    : modelInfo?.contextLength || 8192;

  return { provider, model, contextWindow };
}

async function runModelCase(
  test: EvalCase,
  providerState: Awaited<ReturnType<typeof createLocalEvalProvider>>
): Promise<EvalResult> {
  const started = Date.now();
  const { provider, model, contextWindow } = providerState;
  const system = getSystemMessage('local', model);
  const history: Message[] = [];
  const turns = test.turns || [test.prompt || ''];
  let responseText = '';

  try {
    for (const turn of turns) {
      const budget = createContextBudget(contextWindow, turn, {
        responseReserve: Math.min(512, Math.max(192, Math.floor(contextWindow * 0.2))),
      });
      const fitted = fitHistoryToBudget(history, budget.historyBudget);
      const userMessage: Message = {
        id: 'eval_user_' + Date.now() + '_' + history.length,
        role: 'user',
        content: turn,
        timestamp: new Date(),
      };

      const response = await provider.chat({
        messages: [system, ...fitted.messages, userMessage],
        model,
        temperature: 0.1,
        maxTokens: budget.responseReserve,
      });

      responseText = response.content.trim();
      history.push(userMessage, {
        id: 'eval_assistant_' + Date.now() + '_' + history.length,
        role: 'assistant',
        content: response.content,
        timestamp: new Date(),
      });
    }

    const validation = validateResponse(responseText, test.validator);
    return {
      id: test.id,
      name: test.name,
      category: test.category,
      status: validation.status,
      prompt: turns.join('\n---\n'),
      response: responseText,
      expected: validation.expected,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      id: test.id,
      name: test.name,
      category: test.category,
      status: 'FAIL',
      prompt: turns.join('\n---\n'),
      response: '',
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function writeReport(results: EvalResult[], modelLabel: string): string {
  const root = join(homedir(), '.skycode', 'evals');
  mkdirSync(root, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = join(root, 'eval-' + stamp);

  writeFileSync(base + '.json', JSON.stringify({
    generatedAt: new Date().toISOString(),
    model: modelLabel,
    results,
  }, null, 2), 'utf8');

  const counts = results.reduce<Record<EvalStatus, number>>((acc, result) => {
    acc[result.status] += 1;
    return acc;
  }, { PASS: 0, FAIL: 0, REVIEW: 0, SKIP: 0 });

  const lines: string[] = [
    '# SkyCode AI Eval',
    '',
    'Model: ' + modelLabel,
    'Generated: ' + new Date().toISOString(),
    '',
    'PASS: ' + counts.PASS + ' | FAIL: ' + counts.FAIL + ' | REVIEW: ' + counts.REVIEW + ' | SKIP: ' + counts.SKIP,
    '',
  ];

  for (const result of results) {
    lines.push('## ' + result.id + '. ' + result.name + ' — ' + result.status, '');
    lines.push('Category: ' + result.category);
    if (result.route) lines.push('Route: ' + result.route);
    if (result.expected) lines.push('Expected: ' + result.expected);
    lines.push('Duration: ' + result.durationMs + 'ms', '', 'Prompt:', '~~~text', result.prompt, '~~~', '', 'Response:', '~~~text', result.error || result.response, '~~~', '');
  }

  writeFileSync(base + '.md', lines.join('\n'), 'utf8');
  return base + '.md';
}

function selectCases(args: string[]): EvalCase[] {
  const lower = args.map((arg) => arg.toLowerCase());
  let selected = lower.includes('--all') ? [...EVAL_CASES] : [...SMOKE_CASES];

  const categoryIndex = lower.indexOf('--category');
  if (categoryIndex >= 0 && args[categoryIndex + 1]) {
    selected = EVAL_CASES.filter((test) => test.category === args[categoryIndex + 1]);
  }

  const idsIndex = lower.indexOf('--ids');
  if (idsIndex >= 0 && args[idsIndex + 1]) {
    const ids = new Set(args[idsIndex + 1].split(',').map((value) => Number(value.trim())).filter(Number.isFinite));
    selected = EVAL_CASES.filter((test) => ids.has(test.id));
  }

  const limitIndex = lower.indexOf('--limit');
  if (limitIndex >= 0 && args[limitIndex + 1]) {
    const limit = Number(args[limitIndex + 1]);
    if (Number.isFinite(limit) && limit > 0) selected = selected.slice(0, limit);
  }

  return selected;
}

export async function runEvalCommand(args: string[]): Promise<number> {
  const selected = selectCases(args);
  if (selected.length === 0) {
    console.error('No evaluation cases matched the requested filters.');
    return 1;
  }

  console.log('SkyCode AI eval: ' + selected.length + ' case(s)');
  console.log('Default is the smoke suite. Use --all for all 100 cases.');

  let providerState: Awaited<ReturnType<typeof createLocalEvalProvider>> | null = null;
  const needsModel = selected.some((test) => test.category !== 'routing' && test.category !== 'streaming-ui');

  if (needsModel) {
    try {
      providerState = await createLocalEvalProvider();
      console.log('Model: ' + providerState.model + ' | context: ' + providerState.contextWindow + ' tokens');
    } catch (error) {
      console.error('Could not initialize local model: ' + (error instanceof Error ? error.message : String(error)));
      return 1;
    }
  }

  const results: EvalResult[] = [];

  for (const test of selected) {
    process.stdout.write('[' + test.id + '/100] ' + test.name + '... ');
    let result: EvalResult;

    if (test.category === 'routing') {
      result = await runRoutingCase(test);
    } else if (test.category === 'streaming-ui') {
      result = {
        id: test.id,
        name: test.name,
        category: test.category,
        status: 'SKIP',
        prompt: test.prompt || '',
        response: 'Manual/integration test.',
        expected: test.validator?.type === 'review' ? test.validator.note : 'manual integration check',
        durationMs: 0,
      };
    } else {
      result = await runModelCase(test, providerState!);
    }

    results.push(result);
    console.log(result.status);
  }

  if (providerState) await providerState.provider.close();

  const modelLabel = providerState?.model || 'routing-only';
  const reportPath = writeReport(results, modelLabel);
  const failures = results.filter((result) => result.status === 'FAIL').length;

  console.log('');
  console.log('Report: ' + reportPath);
  console.log(
    'PASS ' + results.filter((r) => r.status === 'PASS').length +
    ' | FAIL ' + failures +
    ' | REVIEW ' + results.filter((r) => r.status === 'REVIEW').length +
    ' | SKIP ' + results.filter((r) => r.status === 'SKIP').length
  );

  return failures > 0 ? 2 : 0;
}
