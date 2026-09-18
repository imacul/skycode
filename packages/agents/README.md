# @sky-code/agents

Sky Code AI Agents - A collection of specialized AI agents for different tasks including planning, build, and business modes.

## Installation

```bash
# npm
npm install @sky-code/agents

# bun
bun add @sky-code/agents

# yarn
yarn add @sky-code/agents
```

## Features

- **Multiple Agent Modes**: `plan`, `build`, `business`, `code`, `chat`, `debug`, `explain`, `refactor`, `test`, `search`
- **Planning Agent**: Specialized for creating detailed plans and roadmaps
- **Business Agent**: Specialized for business strategy and analysis
- **Coding Agent**: Specialized for code-related tasks
- **Chat Agent**: General conversation and knowledge queries
- **Agent Orchestrator**: Intelligent routing of requests to appropriate agents

## Usage

### Basic Usage

```typescript
import { createAgentOrchestrator, agentOrchestrator } from '@sky-code/agents';

// Create orchestrator
const orchestrator = createAgentOrchestrator();

// Initialize with your provider
await orchestrator.initializeAll({
  provider: yourProvider,
  model: 'your-model-name',
  workingDirectory: process.cwd(),
  env: process.env,
});

// Use with a specific mode
const response = await orchestrator.routeRequest({
  input: 'Create a business plan for a SaaS startup',
  mode: 'business',
});

console.log(response.content);
```

### Using Specific Agents

```typescript
import { createPlanningAgent, createBusinessAgent, createCodingAgent } from '@sky-code/agents';

// Create a planning agent
const planningAgent = createPlanningAgent();
await planningAgent.initialize({
  provider: yourProvider,
  model: 'your-model-name',
});

// Use the agent
const plan = await planningAgent.process({
  input: 'Create a project plan for building a new API',
  mode: 'plan',
});

// Create a business agent
const businessAgent = createBusinessAgent();
await businessAgent.initialize({
  provider: yourProvider,
  model: 'your-model-name',
});

// Use the agent
const analysis = await businessAgent.process({
  input: 'Analyze the market for AI-powered code assistants',
  mode: 'business',
});
```

### Streaming Mode

```typescript
import { createAgentOrchestrator } from '@sky-code/agents';

const orchestrator = createAgentOrchestrator();
await orchestrator.initializeAll({
  provider: yourProvider,
  model: 'your-model-name',
});

await orchestrator.routeRequestStream({
  input: 'Create a detailed implementation plan',
  mode: 'plan',
  onStream: (chunk) => {
    process.stdout.write(chunk);
  },
  onComplete: (response) => {
    console.log('\nDone!');
  },
  onError: (error) => {
    console.error('Error:', error.message);
  },
});
```

## Agent Modes

| Mode | Description | Best Agent |
|------|-------------|------------|
| `plan` | Create detailed plans and roadmaps | Planning Agent |
| `build` | Create implementation plans and technical roadmaps | Planning Agent |
| `business` | Business strategy and analysis | Business Agent |
| `code` | Code generation and completion | Coding Agent |
| `debug` | Bug finding and fixing | Coding Agent |
| `explain` | Code explanation | Coding Agent |
| `refactor` | Code refactoring | Coding Agent |
| `test` | Test generation | Coding Agent |
| `search` | Code search and analysis | Coding Agent |
| `chat` | General conversation | Chat Agent |

## Configuration

Each agent can be configured with custom settings:

```typescript
import { createPlanningAgent } from '@sky-code/agents';

const planningAgent = createPlanningAgent({
  name: 'my-planning-agent',
  description: 'Custom planning agent',
  planningSettings: {
    includeTimeline: true,
    includeMilestones: true,
    includeResources: true,
    includeRisks: true,
    includeSuccessMetrics: true,
  },
});
```

## Types

All types are exported from the package:

```typescript
import type {
  BaseAgent,
  AgentConfig,
  AgentContext,
  AgentRequest,
  AgentResponse,
  AgentMode,
  AgentCapability,
  AgentOrchestrator,
  CodingAgentConfig,
  ChatAgentConfig,
  PlanningAgentConfig,
  BusinessAgentConfig,
} from '@sky-code/agents';
```

## License

MIT
