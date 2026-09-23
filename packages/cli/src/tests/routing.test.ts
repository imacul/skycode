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

  it('hard-routes concrete workspace build requests to coding tools', () => {
    expect(
      route(
        'Create a tiny Node.js function that adds two numbers, add a test for it, and run the test to verify it works.'
      )
    ).toBe('coding-agent');
  });

  it('hard-routes project continuation with saved tool history to coding', () => {
    const orchestrator = new SkyCodeAgentOrchestrator();
    const decision = orchestrator.explainRoute({
      input: 'continue and finish it',
      messages: [
        {
          id: 'assistant_tool',
          role: 'assistant',
          content: '<tool_call>terminal <arg_key>command</arg_key> <arg_value>npm test</arg_value> </tool_call>',
          timestamp: new Date(),
        },
      ],
    } as any);
    expect(decision.agentName).toBe('coding-agent');
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
