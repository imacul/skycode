// Main test file - runs all tests
import { describe, it, expect } from 'bun:test';

// Import all test files to run them
import './providers.test';
import './agents.test';
import './tools.test';
import './store.test';
import './utils.test';

describe('Sky Code Tests', () => {
  it('should run all tests', () => {
    expect(true).toBe(true);
  });
});
