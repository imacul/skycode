import { describe, expect, it } from 'bun:test';
import { createAgentOrchestrator } from '../agents/orchestrator';

describe('software capability routing', () => {
  it('routes software creation questions to the coding agent', () => {
    const orchestrator = createAgentOrchestrator();

    expect(
      orchestrator.explainRoute({ input: 'Can you create software?' }).agentName
    ).toBe('coding-agent');

    expect(
      orchestrator.explainRoute({ input: 'Can you build a desktop app?' }).agentName
    ).toBe('coding-agent');

    expect(
      orchestrator.explainRoute({ input: 'Develop a full-stack website for me' }).agentName
    ).toBe('coding-agent');
  });
});
