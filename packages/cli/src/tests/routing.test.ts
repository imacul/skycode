import { describe, expect, it } from 'bun:test';
import { SkyCodeAgentOrchestrator } from '../agents/orchestrator';

describe('agent routing', () => {
  const route = (input: string) =>
    new SkyCodeAgentOrchestrator().explainRoute({ input }).agentName;

  it('routes React explanation to coding', () => {
    expect(route('Explain this React code.')).toBe('coding-agent');
  });

  it('routes business logic bugs to coding', () => {
    expect(route('Fix the business logic bug in this function.')).toBe('coding-agent');
  });

  it('routes pricing strategy to business', () => {
    expect(route('Assess pricing for a developer SaaS.')).toBe('business-agent');
  });

  it('routes implementation plans to planning', () => {
    expect(route('Create an implementation plan for a React API.')).toBe('planning-agent');
  });

  it('routes casual conversation to chat', () => {
    expect(route('Tell me a short joke about rain.')).toBe('chat-agent');
  });

  it('keeps previous route for short follow-ups without a new signal', () => {
    const orchestrator = new SkyCodeAgentOrchestrator();
    const first = orchestrator.explainRoute({ input: 'Write a TypeScript debounce function.' });
    (orchestrator as any).lastRouteDecision = first;

    const followUp = orchestrator.explainRoute({ input: 'Can you improve that?' });
    expect(followUp.agentName).toBe('coding-agent');
  });
});
