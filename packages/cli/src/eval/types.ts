export type EvalStatus = 'PASS' | 'FAIL' | 'REVIEW' | 'SKIP';

export type EvalValidator =
  | { type: 'exact'; value: string; caseSensitive?: boolean }
  | { type: 'contains'; value: string; caseSensitive?: boolean }
  | { type: 'not_contains'; values: string[]; caseSensitive?: boolean }
  | { type: 'regex'; pattern: string; flags?: string }
  | { type: 'json' }
  | { type: 'review'; note: string };

export interface EvalCase {
  id: number;
  name: string;
  category:
    | 'identity'
    | 'instruction'
    | 'memory'
    | 'reasoning'
    | 'coding'
    | 'routing'
    | 'streaming-ui';
  prompt?: string;
  turns?: string[];
  validator?: EvalValidator;
  routeExpected?: string[];
  smoke?: boolean;
}

export interface EvalResult {
  id: number;
  name: string;
  category: EvalCase['category'];
  status: EvalStatus;
  prompt: string;
  response: string;
  expected?: string;
  durationMs: number;
  route?: string;
  error?: string;
}
