import { describe, expect, test } from 'bun:test';
import { SkyCodeAgentOrchestrator } from '../agents/orchestrator';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateNotepadTarget, runWindowsDesktop, validateComputerStep, verifyComputerObservation, validateComputerWindowSelector, validateComputerTextVerification } from '../agents/windows-desktop';
import { PROJECT_TOOL_NAMES, getProjectToolInstructions, needsReachTools, parseProjectToolCalls, selectDesktopObservation, projectToolResultMessage, shouldCaptureGuiFeedback } from '../agents/project-tools';

describe('Windows desktop operator milestone', () => {
  test('rejects traversal, absolute paths and non-text documents', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'skycode-desktop-'));
    try {
      for (const name of ['../secret.txt', '..\\secret.txt', 'C:\\Windows\\test.txt', '/tmp/test.txt', '.hidden.txt', 'report.md', 'note.txt/other']) {
        expect(() => validateNotepadTarget(name, workspace)).toThrow();
      }
      expect(validateNotepadTarget('demo-note.txt', workspace)).toBe(join(workspace, 'demo-note.txt'));
      writeFileSync(join(workspace, 'demo-note.txt'), 'already here');
      expect(() => validateNotepadTarget('demo-note.txt', workspace)).toThrow(/exists/);
    } finally { rmSync(workspace, { recursive: true, force: true }); }
  });
  test('registers desktop tools and routes computer requests', () => {
    expect(PROJECT_TOOL_NAMES).toContain('computer_observe');
    expect(PROJECT_TOOL_NAMES).toContain('computer_observe_window');
    expect(PROJECT_TOOL_NAMES).toContain('computer_focus_window');
    expect(PROJECT_TOOL_NAMES).toContain('computer_act');
    expect(PROJECT_TOOL_NAMES).toContain('computer_batch');
    expect(PROJECT_TOOL_NAMES).toContain('computer_verify');
    expect(PROJECT_TOOL_NAMES).toContain('desktop_snapshot');
    expect(PROJECT_TOOL_NAMES).toContain('desktop_list_windows');
    expect(PROJECT_TOOL_NAMES).toContain('desktop_close_document');
    expect(needsReachTools('close the file')).toBe(true);
    expect(needsReachTools('close the document')).toBe(true);
    expect(PROJECT_TOOL_NAMES).toContain('desktop_notepad_document');
    expect(needsReachTools('Open Notepad and create a note')).toBe(true);
    expect(needsReachTools('Inspect the current desktop window')).toBe(true);
    const prompt = getProjectToolInstructions(process.cwd());
    expect(prompt).toContain('desktop_notepad_document');
    expect(prompt).toContain('desktop_close_document');
    expect(prompt).toContain('desktop_list_windows');
    expect(prompt).toContain('computer_batch');
    expect(prompt).toContain('requires approval');
    expect(parseProjectToolCalls('<tool_call>{"name":"desktop_notepad_document","args":{"filename":"demo.txt","content":"hello","reason":"demo"}}</tool_call>')).toHaveLength(1);
  });
  test('does not operate a non-Windows desktop', async () => {
    if (process.platform !== 'win32') {
      await expect(runWindowsDesktop({ action: 'snapshot' })).rejects.toThrow(/Windows only/);
    }
  });
});

describe('desktop observation fast path and token feedback', () => {
  test('uses a read-only desktop primitive for explicit window listing', () => {
    expect(selectDesktopObservation('List the applications and windows currently open on my computer.')?.name).toBe('desktop_list_windows');
    expect(selectDesktopObservation('Show currently running apps')?.name).toBe('desktop_list_windows');
    expect(selectDesktopObservation('Close my currently open Notepad window')).toBeNull();
    expect(selectDesktopObservation('Make an app that lists open windows')).toBeNull();
  });

  test('caps oversized tool output before sending it back to the model', () => {
    const result = projectToolResultMessage([{
      call: { name: 'run_command', args: { command: 'echo example' } },
      success: false, trust: 'untrusted-data', content: 'F'.repeat(25000),
    }]);
    expect(result.content.length).toBeLessThan(4500);
    expect(result.content).toContain('truncated');
  });
});

describe('Windows desktop PowerShell adapter syntax', () => {
  test('parses the entire script before any desktop action is run', () => {
    if (process.platform !== 'win32') return;
    const script = resolve(import.meta.dir, '../../scripts/windows-desktop.ps1');
    const escapedPath = script.replace(/'/g, "''");
    const check = '$tokens=$null; $parseErrors=$null; ' +
      "[System.Management.Automation.Language.Parser]::ParseFile('" + escapedPath + "',[ref]$tokens,[ref]$parseErrors) | Out-Null; " +
      'if($parseErrors.Count -gt 0) { $parseErrors | ForEach-Object { Write-Output $_.ToString() }; exit 1 }';
    const parse = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', check,
    ], { encoding: 'utf8', timeout: 15000 });
    expect(parse.error).toBeUndefined();
    if (parse.status !== 0) throw new Error('Legacy PowerShell syntax: ' + parse.stdout + '\n' + parse.stderr);
    expect(parse.status).toBe(0);
    const coreScript = resolve(import.meta.dir, '../../scripts/computer-core.ps1');
    const corePath = coreScript.replace(/'/g, "''");
    const checkCore = '$tokens=$null; $parseErrors=$null; ' +
      "[System.Management.Automation.Language.Parser]::ParseFile('" + corePath + "',[ref]$tokens,[ref]$parseErrors) | Out-Null; " +
      'if($parseErrors.Count -gt 0) { $parseErrors | ForEach-Object { Write-Output $_.ToString() }; exit 1 }';
    const coreParse = spawnSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command',checkCore], {encoding:'utf8',timeout:15000});
    expect(coreParse.error).toBeUndefined();
    if (coreParse.status !== 0) throw new Error('Computer core PowerShell syntax: ' + coreParse.stdout + '\n' + coreParse.stderr);
    expect(coreParse.status).toBe(0);
  }, 30000);
});

describe('window state classification contract', () => {
  test('adapter distinguishes minimized from visible and separates shell UI', () => {
    const file = resolve(import.meta.dir, '../../scripts/computer-core.ps1');
    const script = readFileSync(file, 'utf8');
    expect(script).toContain('IsIconic');
    expect(script).toContain('IsWindowVisible');
    expect(script).toContain("'system-ui'");
    expect(script).toContain("'minimized'");
    expect(script).toContain("'visible'");
    expect(script).toContain('GetForegroundWindow');
  });
});

describe('generic computer operations', () => {
  const window = {expectedTitle:'Untitled - Notepad',expectedProcessId:123};
  test('requires target identity and restricts unsupported shortcuts', () => {
    expect(() => validateComputerStep({kind:'invoke',...window,name:'Save'})).not.toThrow();
    expect(() => validateComputerStep({kind:'invoke',...window})).toThrow(/Specify/);
    expect(() => validateComputerStep({kind:'keypress',...window,keys:'%{F4}'})).toThrow(/shortcut/);
    expect(() => validateComputerStep({kind:'set_value',...window,name:'Text',value:'x'.repeat(3001)})).toThrow(/long/);
  });
});

describe('semantic pointer and keyboard actions', () => {
  const target = {expectedTitle:'Untitled - Notepad',expectedProcessId:999,name:'Text editor'};
  test('permits target-aware pointer and text operations', () => {
    for (const kind of ['move','click','right_click','double_click','focus','type'] as const) {
      expect(() => validateComputerStep({ ...target, kind, value:kind === 'type' ? 'Hello' : undefined })).not.toThrow();
    }
    expect(() => validateComputerStep({...target,kind:'type'})).toThrow(/value required/);
    expect(() => validateComputerStep({...target,kind:'type',value:'a'.repeat(1001)})).toThrow(/too long/);
    expect(() => validateComputerStep({...target,kind:'keypress',keys:'{BACKSPACE}'})).not.toThrow();
    expect(() => validateComputerStep({...target,kind:'keypress',keys:'%{F4}'})).toThrow(/shortcut/);
  });
  test('PowerShell adapter uses UIA hit testing, foreground guards, and escaped literal text', () => {
    const script = readFileSync(resolve(import.meta.dir, '../../scripts/computer-core.ps1'), 'utf8');
    expect(script).toContain('AutomationElement]::FromPoint');
    expect(script).toContain('GetSafePoint');
    expect(script).toContain('SetCursorPos');
    expect(script).toContain('mouse_event');
    expect(script).toContain('Typing requires an accessible Edit or Document control.');
    expect(script).toContain('SendLiteralText');
    expect(script).toContain("if($kind -eq 'move' -or $kind -eq 'click'");
  });
});

describe('deterministic desktop verification', () => {
  test('checks actual foreground identity rather than trusting tool success', () => {
    const window = { title: 'Notepad', processId: 4321, nodes: [{ name: 'Editor' }] };
    expect(verifyComputerObservation({ window }, { expectedTitle: 'Notepad', expectedProcessId: 4321, controlName: 'Editor' }).verified).toBe(true);
    expect(verifyComputerObservation({ window }, { expectedTitle: 'PowerShell', expectedProcessId: 4321 }).verified).toBe(false);
    expect(verifyComputerObservation({ window }, { expectedTitle: 'Notepad', expectedProcessId: 4321, controlName: 'Save' }).verified).toBe(false);
  });
});

describe('target-aware Windows selection', () => {
  test('rejects ambiguous or invalid window identities before PowerShell execution', () => {
    expect(() => validateComputerWindowSelector({title: 'Untitled - Notepad',processId: 4242,windowHandle:'123456'})).not.toThrow();
    expect(() => validateComputerWindowSelector({title: '',processId: 4242})).toThrow();
    expect(() => validateComputerWindowSelector({title: 'Notepad',processId: 0})).toThrow();
    expect(() => validateComputerWindowSelector({title: 'Notepad',processId: 4242,windowHandle:'0x10'})).toThrow();
  });
  test('exposes targeted observation and focus only through exact UIA identity matching', () => {
    const script = readFileSync(resolve(import.meta.dir, '../../scripts/computer-core.ps1'), 'utf8');
    expect(script).toContain('function FindWindow($selector)');
    expect(script).toContain('Window selector must match one');
    expect(script).toContain("if($request.action -eq 'observe_window')");
    expect(script).toContain("if($request.action -eq 'focus_window')");
    expect(script).toContain('GetForegroundWindow() -ne $handle');
  });
});

describe('native Windows typing regression', () => {
  test('uses SendInput Unicode events rather than background PowerShell SendKeys for text', () => {
    const script = readFileSync(resolve(import.meta.dir, '../../scripts/computer-core.ps1'), 'utf8');
    const typed = script.slice(script.indexOf('function SendLiteralText('), script.indexOf('function RunStep('));
    expect(typed).toContain('[SkyKeyboardNative]::SendUnicode');
    expect(typed).toContain('GetForegroundWindow() -ne $handle');
    expect(typed).not.toContain('SendKeys');
    expect(script).toContain('public static extern uint SendInput');
    expect(script).toContain('Windows SendInput failed');
    expect(script).toContain('$readback=VerifyText $window');
    expect(script).toContain('verificationReason=[string]$readback.reason');
    expect(script).toContain('textVerified=[bool]$readback.verified');
  });
});

describe('editor-content verification regression', () => {
  test('requires bounded explicit text and exact window identity', () => {
    expect(() => validateComputerTextVerification({expectedTitle:'Notepad',expectedProcessId:55,expectedText:'Hello from SkyCode'})).not.toThrow();
    expect(() => validateComputerTextVerification({expectedTitle:'Notepad',expectedProcessId:55,expectedText:''})).toThrow();
    expect(() => validateComputerTextVerification({expectedTitle:'Notepad',expectedProcessId:55,expectedText:'x'.repeat(1001)})).toThrow();
    expect(() => validateComputerTextVerification({expectedTitle:'',expectedProcessId:55,expectedText:'Hi'})).toThrow();
  });
  test('text verification is not bounded by the first 40 observed controls', () => {
    const script = readFileSync(resolve(import.meta.dir, '../../scripts/computer-core.ps1'), 'utf8');
    expect(script).toContain('function VerifyText(');
    expect(script).toContain("if($request.action -eq 'verify_text')");
    expect(script).toContain('TextPattern');
    expect(script).toContain('ValuePattern');
    expect(script).toContain('Math]::Min($all.Count,3000)');
    expect(script).toContain('No readable editor text was exposed');
  });
});

describe('computer task failure reporting regression', () => {
  test('failure fuse never labels a successful observation as the last error', () => {
    const agent = readFileSync(resolve(import.meta.dir, '../agents/coding-agent.ts'), 'utf8');
    expect(agent).toContain('tail.every(item => !item.success)');
    expect(agent).toContain('failed.call.name');
    expect(agent).not.toContain('recentFailures[recentFailures.length - 1]?.content');
  });
  test('guides natural-language requests through action before text verification', () => {
    const tools = readFileSync(resolve(import.meta.dir, '../agents/project-tools.ts'), 'utf8');
    expect(tools).toContain('THEN verify expectedText');
    expect(tools).toContain('Never call computer_verify expectedText before the write');
  });
});

describe('semantic drag and mouse release', () => {
  const window = { expectedTitle: 'Untitled - Notepad', expectedProcessId: 101 };
  test('drag requires named and different source/destination controls', () => {
    expect(() => validateComputerStep({ ...window, kind: 'drag', name: 'A', targetName: 'B' })).not.toThrow();
    expect(() => validateComputerStep({ ...window, kind: 'drag', name: 'A' })).toThrow(/destination/);
    expect(() => validateComputerStep({ ...window, kind: 'drag', name: 'A', targetName: 'A' })).toThrow(/different/);
    expect(() => validateComputerStep({ ...window, kind: 'drag', targetName: 'B' })).toThrow(/Specify/);
  });
  test('both endpoints are hit tested and left mouse is released on interruption', () => {
    const script = readFileSync(resolve(import.meta.dir, '../../scripts/computer-core.ps1'), 'utf8');
    const start = script.indexOf('function DragBetweenControls(');
    const end = script.indexOf('function SendLiteralText(', start);
    const drag = script.slice(start, end);
    expect(drag).toContain('GetSafePoint $window $source');
    expect(drag).toContain('GetSafePoint $window $destination');
    expect(drag).toContain('GetForegroundWindow() -ne $handle');
    expect(drag).toContain('}finally{');
    expect(drag).toContain('[SkyMouseFlags]::LEFT_UP');
    expect(script).toContain('outcomeVerified=$false');
  });
});

describe('cross-application UI control disambiguation', () => {
  test('requires conjunction of all supplied selectors, not fallback from ID to name', () => {
    const adapter = readFileSync(resolve(import.meta.dir, '../../scripts/computer-core.ps1'), 'utf8');
    expect(adapter).toContain('if($step.automationId -and $c.AutomationId -cne');
    expect(adapter).toContain('if($step.name -and $c.Name -cne');
    expect(adapter).toContain('if($step.role -and $c.ControlType.ProgrammaticName -cne');
    expect(adapter).toContain('candidates:');
    expect(adapter).toContain('Select-Object -First 6');
  });
  test('guides recovery without duplicating windows or guessing shell commands', () => {
    const src = readFileSync(resolve(import.meta.dir, '../agents/project-tools.ts'), 'utf8');
    expect(src).toContain('Never retry the same ambiguous selector');
    expect(src).toContain('reuse the existing target if it is already open');
    expect(src).toContain('Do not attempt fragile shell commands');
  });
});

describe('physical Windows mouse interaction', () => {
  test('pointer action moves visibly, checks location, and reports physical input evidence', () => {
    const script = readFileSync(resolve(import.meta.dir, '../../scripts/computer-core.ps1'), 'utf8');
    const mouse = script.slice(script.indexOf('function MouseAction('), script.indexOf('function DragBetweenControls('));
    expect(mouse).toContain('GetCursorPos([ref]$origin)');
    expect(mouse).toContain('SetCursorPos($x,$y)');
    expect(mouse).toContain('Start-Sleep -Milliseconds 18');
    expect(mouse).toContain('Pointer failed to reach target');
    expect(mouse).toContain("method='physical-mouse'");
    expect(mouse).toContain('clicksSent=$sent');
    expect(mouse).toContain('outcomeVerified=$false');
    expect(script).toContain('pointer=$position');
  });
  test('agent honors literal mouse requests and distinguishes activity from workspace inspection', () => {
    const tools = readFileSync(resolve(import.meta.dir, '../agents/project-tools.ts'), 'utf8');
    const agent = readFileSync(resolve(import.meta.dir, '../agents/coding-agent.ts'), 'utf8');
    expect(tools).toContain('UIA invoke, app launch commands and keyboard shortcuts do NOT count as mouse interaction.');
    expect(agent).toContain('Using Windows mouse: ');
    expect(agent).toContain('Mouse action sent: ');
  });
});

describe('natural-language mouse task routing', () => {
  test('routes real Windows pointer actions to the tool loop', () => {
    expect(needsReachTools("Move my mouse to the View button in File Explorer and click it. Tell me what options appear. Don't change any files.")).toBe(true);
    expect(needsReachTools('Click the View menu in File Explorer')).toBe(true);
    expect(needsReachTools('Drag the selected item in File Explorer')).toBe(true);
    expect(needsReachTools('Scroll down in the current Windows application')).toBe(true);
    expect(needsReachTools('Move the pointer to the Chrome search field')).toBe(true);
    expect(needsReachTools('Take a screenshot of my Windows screen')).toBe(true);
    expect(needsReachTools('Capture the current computer window')).toBe(true);
  });
  test('leaves explanatory questions in ordinary chat', () => {
    expect(needsReachTools('How do I click the View button in File Explorer?')).toBe(false);
    expect(needsReachTools('What is a mouse pointer?')).toBe(false);
    expect(needsReachTools('Explain how to drag files in Windows.')).toBe(false);
  });
});

describe('transient screenshot tool feedback', () => {
  test('provides image data to model without embedding it in the text transcript', () => {
    const dataUrl = 'data:image/jpeg;base64,' + 'A'.repeat(2000);
    const message = projectToolResultMessage([{
      call: { name: 'computer_screenshot', args: { reason: 'Inspect window' } },
      success: true, trust: 'untrusted-data', content: '{"ok":true}',
      imageDataUrl: dataUrl,
    }]);
    expect(message.imageDataUrl).toBe(dataUrl);
    expect(message.content).not.toContain(dataUrl);
    expect(message.content).toContain('"computer_screenshot"');
  });
});

describe('screenshot vision computer fallback', () => {
  test('registers screenshot tool and warns about provider requirements', () => {
    expect(PROJECT_TOOL_NAMES).toContain('computer_screenshot');
    const prompt = getProjectToolInstructions(process.cwd());
    expect(prompt).toContain('computer_screenshot');
    expect(prompt).toContain('kind visual_click');
    expect(prompt).toContain('actual attached image');
  });
  test('validates exact screenshot-relative click identity and image bounds', () => {
    const screenshot = {
      path:'C:\\Temp\\skycode-window-0123456789abcdef0123456789abcdef.jpg',
      scope:'window' as const,
      title:'File Explorer',processId:123,windowHandle:'123456',
      left:10,top:20,width:1400,height:900,imageWidth:1120,imageHeight:720,capturedAt:1234567,
    };
    const base = { kind:'visual_click' as const, expectedTitle:'File Explorer',expectedProcessId:123,pointerKind:'click' as const,snapshot:screenshot,x:100,y:100 };
    expect(() => validateComputerStep(base)).not.toThrow();
    expect(() => validateComputerStep({...base,x:1120})).toThrow(/Visual click/);
    expect(() => validateComputerStep({...base,snapshot:{...screenshot,processId:124}})).toThrow(/Visual click/);
    expect(() => validateComputerStep({...base,pointerKind:'move' as any})).toThrow(/Visual click/);
  });
  test('screenshot is bounded and coordinate clicking checks stale identity', () => {
    const script=readFileSync(resolve(import.meta.dir,'../../scripts/computer-core.ps1'),'utf8');
    expect(script).toContain('function CaptureScreen');
    expect(script).toContain("if($request.action -eq 'capture')");
    expect(script).toContain('CopyFromScreen');
    expect(script).toContain('1280.0/$width');
    expect(script).toContain('function VisualClick');
    expect(script).toContain("if($age -lt 0 -or $age -gt 60000)");
    expect(script).toContain('Screenshot window identity is stale or mismatched');
    expect(script).toContain('Sensitive control; coordinate click denied');
    expect(script).toContain('Remove-Item -LiteralPath');
  });
  test('multimodal model providers retain image content alongside tool results', () => {
    const openrouter=readFileSync(resolve(import.meta.dir,'../providers/openrouter.ts'),'utf8');
    const openai=readFileSync(resolve(import.meta.dir,'../providers/openai.ts'),'utf8');
    const tools=readFileSync(resolve(import.meta.dir,'../agents/project-tools.ts'),'utf8');
    expect(openrouter).toContain('msg.imageDataUrl');
    expect(openai).toContain('msg.imageDataUrl');
    const chatgpt=readFileSync(resolve(import.meta.dir,'../providers/chatgpt.ts'),'utf8');
    expect(chatgpt).toContain('m.imageDataUrl');
    expect(chatgpt).toContain("type: 'input_image'");
    expect(tools).toContain('imageDataUrl: [...executions].reverse().find(item => item.imageDataUrl)?.imageDataUrl');
    expect(tools).toContain("data:image/jpeg;base64,");
  });
});

describe('model-led general task routing', () => {
  const router = new SkyCodeAgentOrchestrator();
  const route = (input: string) => router.explainRoute({ input } as any).agentName;
  test('does not require a command verb or hardcoded application name', () => {
    expect(route('Go to vscode and create a file named learn')).toBe('coding-agent');
    expect(route('Go to the opened file explorer and creat a folder called own and stop there')).toBe('coding-agent');
    expect(route('Open it and goand click on "This PC"')).toBe('coding-agent');
    expect(route('open it')).toBe('coding-agent');
    expect(route('Move my mouse to the View button in File Explorer and click it.')).toBe('coding-agent');
    expect(route('Bring up the thing we just discussed')).toBe('coding-agent');
  });
  test('keeps conversation possible and preserves explicitly chosen specialist agents', () => {
    expect(route('Good evening. How are you?')).toBe('coding-agent');
    expect(router.explainRoute({ input: 'Price this product', mode: 'business' } as any).agentName).toBe('business-agent');
    expect(router.explainRoute({ input: 'Hi', context: { agent: 'chat-agent' } } as any).agentName).toBe('chat-agent');
  });
  test('never uses keyword gates to decide whether tools are available', () => {
    const agent = readFileSync(resolve(import.meta.dir,'../agents/coding-agent.ts'),'utf8');
    expect(agent).toContain('private shouldRunProjectTools(_request: AgentRequest): boolean');
    expect(agent).toContain('return true;');
    expect(agent).toContain("request.context?.toolLoopMode === 'build' ? 'build' : 'reach'");
    expect(agent).not.toContain('const loopMode = classifyToolLoopMode(request.input)');
  });
});

describe('dynamic prerequisite discovery and GUI completion', () => {
  test('the common model plan handles missing windows without application-specific routing', () => {
    const instructions = getProjectToolInstructions(process.cwd());
    expect(instructions).toContain('infer prerequisite actions');
    expect(instructions).toContain('open_app when necessary');
    expect(instructions).toContain('A screenshot taken from the wrong application cannot verify');
    expect(instructions).toContain('re-enumerate and focus the requested window');
    expect(instructions).toContain('the original task remains incomplete');
    const agent = readFileSync(resolve(import.meta.dir, '../agents/coding-agent.ts'), 'utf8');
    expect(agent).toContain('plan and execute any reasonable prerequisites');
    expect(agent).toContain('When a screenshot shows a different app');
    expect(agent).toContain('Never claim that an action or menu state succeeded without current tool evidence');
  });
  test('desktop tasks are tool-capable regardless of how the user phrases prerequisites', () => {
    const router = new SkyCodeAgentOrchestrator();
    const samples = [
      'Look at the actual screenshot of my File Explorer window. Identify the View button using what you see, click it with the mouse, and tell me which options appear. Do not modify any files.',
      'Look at it, then do the thing I asked in the application.',
      'Bring up the editor if needed and put my note there.',
      'Go to the app and finish the task, even if it is not running.',
    ];
    for (const input of samples) {
      expect(router.explainRoute({ input } as any).agentName).toBe('coding-agent');
    }
  });
});

describe('GUI-first autonomous computer workflow', () => {
  test('general computer instructions prioritize human-like operation over shell commands', () => {
    const instructions = getProjectToolInstructions(process.cwd());
    expect(instructions).toContain('Desktop operation strategy (for any application');
    expect(instructions).toContain('operate it like a human');
    expect(instructions).toContain('A command shell is NOT the default method of desktop navigation');
    expect(instructions).toContain('use a fresh computer_screenshot and visual_click');
    expect(instructions).toContain('Avoid redundant observations');
  });
  test('tool loop prevents repeated passive desktop inspections without actions', () => {
    const agent = readFileSync(resolve(import.meta.dir,'../agents/coding-agent.ts'),'utf8');
    expect(agent).toContain('let lastPassiveObservation');
    expect(agent).toContain('repeatedPassiveObservations >= 2');
    expect(agent).toContain('Repeated the same read-only desktop observation');
    expect(agent).toContain('physical mouse/keyboard actions and screenshots, not shell navigation');
  });
  test('activity log shows computer operations instead of misleading workspace messages', () => {
    const agent = readFileSync(resolve(import.meta.dir,'../agents/coding-agent.ts'),'utf8');
    expect(agent).toContain("call.name.startsWith('computer_')");
    expect(agent).toContain("'Looking at Windows screen'");
    expect(agent).toContain("'Windows interface inspected'");
    expect(agent).toContain("'visual_click'");
  });
});

describe('real screenshot handoff and resilient foreground actions', () => {
  test('screenshot pixels are kept through the provider call rather than cleared beforehand', () => {
    const code = readFileSync(resolve(import.meta.dir, '../agents/coding-agent.ts'), 'utf8');
    const afterStart = code.indexOf('for (let iteration = 0; iteration < maxIterations;');
    const sent = code.indexOf('response = await this.context.provider.chat({', afterStart);
    const cleared = code.indexOf('if (message.imageDataUrl) delete message.imageDataUrl;', afterStart);
    expect(sent).toBeGreaterThan(afterStart);
    expect(cleared).toBeGreaterThan(sent);
    expect(code.slice(afterStart, sent)).not.toContain('delete message.imageDataUrl');
  });
  test('semantic GUI steps can refocus their exact window, but visual click refuses stale screenshots', () => {
    const script = readFileSync(resolve(import.meta.dir, '../../scripts/computer-core.ps1'), 'utf8');
    const runStep = script.slice(script.indexOf('function RunStep('), script.indexOf('\ntry{\n $request=', script.indexOf('function RunStep(')));
    expect(runStep).toContain('$candidate=FindWindow');
    expect(runStep).toContain('$window=FocusWindow $candidate');
    expect(runStep).toContain("if($kind -eq 'visual_click'){throw 'Foreground changed since screenshot");
  });
  test('existing windows are reused from observed process identity before launching', () => {
    const tools = readFileSync(resolve(import.meta.dir, '../agents/project-tools.ts'), 'utf8');
    expect(tools).toContain("const inventory = await runComputerCore('list_windows')");
    expect(tools).toContain("window.processName.toLowerCase() === normalized");
    expect(tools).toContain("await runComputerCore('focus_window'");
    expect(tools).toContain('Reused and focused the already open application window');
  });
  test('autonomous task will not open the same app more than once', () => {
    const code = readFileSync(resolve(import.meta.dir, '../agents/coding-agent.ts'), 'utf8');
    expect(code).toContain('const launchedApplicationTargets = new Set<string>()');
    expect(code).toContain('if (launchedApplicationTargets.has(target))');
    expect(code).toContain('Enumerate existing windows and focus the target instead of launching another instance.');
  });
});

describe('whole-desktop visual observation', () => {
  test('captures the virtual screen instead of just floating foreground widgets', () => {
    const script=readFileSync(resolve(import.meta.dir,'../../scripts/computer-core.ps1'),'utf8');
    expect(script).toContain('function CaptureScreen([string]$scope)');
    expect(script).toContain("if($scope -eq 'window')");
    expect(script).toContain('$left=[int]$screenBounds.Left');
    expect(script).toContain('$right=[int]$screenBounds.Right');
    expect(script).toContain('CaptureScreen $scope');
    expect(script).toContain("else{'desktop'}");
  });
  test('defaults to desktop while preserving explicit window-only scope', () => {
    const code=readFileSync(resolve(import.meta.dir,'../agents/project-tools.ts'),'utf8');
    expect(code).toContain("const scope = args.scope == null ? 'desktop' : args.scope");
    expect(code).toContain("runComputerCore('capture', [], undefined, undefined, scope)");
    expect(code).toContain('including wallpaper, icons, taskbar and overlays');
  });
  test('rejects desktop-scoped screenshots for window-coordinate actions', () => {
    const capture={
      path:'C:\\Temp\\skycode-window-0123456789abcdef0123456789abcdef.jpg',
      scope:'desktop' as const,title:'Desktop',processId:111,windowHandle:'7654',
      left:0,top:0,width:1920,height:1080,imageWidth:1280,imageHeight:720,capturedAt:10000
    };
    expect(() => validateComputerStep({
      kind:'visual_click',expectedTitle:'Desktop',expectedProcessId:111,
      snapshot:capture,x:50,y:50,pointerKind:'click'
    })).toThrow(/Visual click/);
    const script=readFileSync(resolve(import.meta.dir,'../../scripts/computer-core.ps1'),'utf8');
    expect(script).toContain("if($snap.scope -cne 'window')");
  });
});

describe('automatic dynamic visual loop', () => {
  test('feeds new screen pixels to the model after GUI actions, including failures', () => {
    const source=readFileSync(resolve(import.meta.dir,'../agents/project-tools.ts'),'utf8');
    expect(source).toContain("const result = await runComputerCore('capture', [], undefined, undefined, scope)");
    expect(source).toContain("if (needsVisual && ['chatgpt','openai','openrouter'].includes");
    expect(source).toContain('const needsVisual = shouldCaptureGuiFeedback(result.ok === true, stepKinds)');
    expect(source).toContain("try { visual = await captureComputerFeedback('desktop'); }");
    expect(source).toContain("result = { ok: false, error: actionError }");
    expect(source).toContain("imageDataUrl: visual?.imageDataUrl");
    expect(source).toContain("Fresh pixels after the attempted action");
    expect(source).toContain("imageDataUrl: [...executions].reverse().find");
  });
  test('refreshes screenshot when the model focuses a different window', () => {
    const source=readFileSync(resolve(import.meta.dir,'../agents/project-tools.ts'),'utf8');
    expect(source).toContain("if (focusing && ['openai', 'openrouter', 'chatgpt'].includes");
    expect(source).toContain('Fresh screen pixels after window focus');
  });
  test('attempts semantic UI Automation focus when Windows refuses foreground activation', () => {
    const adapter=readFileSync(resolve(import.meta.dir,'../../scripts/computer-core.ps1'),'utf8');
    expect(adapter).toContain('try {$window.SetFocus(); Start-Sleep -Milliseconds 180}');
    expect(adapter).toContain('No input was sent; refresh desktop observation');
  });
  test('the model gets screenshot images after capture but not repeatedly in future rounds', () => {
    const agent=readFileSync(resolve(import.meta.dir,'../agents/coding-agent.ts'),'utf8');
    const send=agent.indexOf('response = await this.context.provider.chat({');
    const clear=agent.indexOf('if (message.imageDataUrl) delete message.imageDataUrl;',send);
    expect(send).toBeGreaterThan(0);
    expect(clear).toBeGreaterThan(send);
  });
});

describe('outcome-oriented desktop efficiency', () => {
  test('tracks real tool progress and bounds repeated failures and slow desktop runs', () => {
    const agent = readFileSync(resolve(import.meta.dir, '../agents/coding-agent.ts'), 'utf8');
    expect(agent).toContain('const desktopProgress: string[] = []');
    expect(agent).toContain('desktopRounds += 1');
    expect(agent).toContain('repeatedDesktopFailures >= 3 || desktopRounds >= 16');
    expect(agent).toContain('DESKTOP TASK PROGRESS (actual executed operations');
    expect(agent).toContain('Do not repeat successful steps');
  });
  test('returns lightweight semantic feedback for keyboard and nonclick actions', () => {
    const source = readFileSync(resolve(import.meta.dir, '../agents/project-tools.ts'), 'utf8');
    expect(source).toContain('export function shouldCaptureGuiFeedback');
    expect(source).toContain("observationMode: needsVisual ? 'capture-unavailable' : 'semantic'");
    expect(source).toContain('Use the adapter post-action UIA observation');
  });
  test('does not launch another app when the existing window refuses focus', () => {
    const source = readFileSync(resolve(import.meta.dir, '../agents/project-tools.ts'), 'utf8');
    expect(source).toContain('Do not launch another instance. Observe current screen');
    expect(source).toContain('Unable to check existing windows');
  });
});

describe('adaptive GUI feedback decisions', () => {
  test('does not waste screenshots on successful semantic and keyboard operations', () => {
    expect(shouldCaptureGuiFeedback(true, ['focus'])).toBe(false);
    expect(shouldCaptureGuiFeedback(true, ['keypress'])).toBe(false);
    expect(shouldCaptureGuiFeedback(true, ['move'])).toBe(false);
    expect(shouldCaptureGuiFeedback(true, ['set_value'])).toBe(false);
    expect(shouldCaptureGuiFeedback(true, ['scroll_view'])).toBe(true);
  });
  test('captures visual evidence for pointer interaction and failures', () => {
    for (const action of ['click','double_click','right_click','visual_click','drag']) {
      expect(shouldCaptureGuiFeedback(true, [action])).toBe(true);
    }
    expect(shouldCaptureGuiFeedback(false, ['focus'])).toBe(true);
    expect(shouldCaptureGuiFeedback(false, ['keypress'])).toBe(true);
  });
});

describe('goal-directed viewport exploration', () => {
  test('accepts guarded window-scoped wheel scrolling without hardcoded target names', () => {
    expect(() => validateComputerStep({
      kind: 'scroll_view', expectedTitle: 'Any App', expectedProcessId: 123,
      direction: 'down', notches: 2, atXPercent: 70, atYPercent: 60,
    })).not.toThrow();
    expect(() => validateComputerStep({
      kind: 'scroll_view', expectedTitle: 'Any App', expectedProcessId: 123,
      direction: 'up',
    })).not.toThrow();
    for (const x of [-1,0,4,96,101,Infinity,NaN]) {
      expect(() => validateComputerStep({
        kind: 'scroll_view', expectedTitle: 'Any App', expectedProcessId: 123,
        direction: 'down', atXPercent: x,
      })).toThrow(/Viewport scroll/);
    }
    for (const notches of [0,6,-1,1.5]) {
      expect(() => validateComputerStep({
        kind: 'scroll_view', expectedTitle: 'Any App', expectedProcessId: 123,
        direction: 'down', notches
      })).toThrow(/Viewport scroll/);
    }
  });
  test('desktop adapter provides scroll progress and physical viewport wheel input', () => {
    const script = readFileSync(resolve(import.meta.dir, '../../scripts/computer-core.ps1'), 'utf8');
    expect(script).toContain('function ScrollViewport(');
    expect(script).toContain("[SkyMouseFlags]::WHEEL");
    expect(script).toContain("if($kind -eq 'scroll_view')");
    expect(script).toContain('return @{kind=$kind;scroll=$wheel;after=Observe (Foreground) 40');
    expect(script).toContain('$node.scroll=@{vertical=');
    expect(script).toContain('$step.atXPercent');
    expect(script).toContain('$step.atYPercent');
  });
  test('model is told to inspect hidden content until goal is met rather than stop at visible entries', () => {
    const instructions = getProjectToolInstructions(process.cwd());
    expect(instructions).toContain('compare');
    expect(instructions).toContain('kind scroll_view');
    expect(instructions).toContain('Never invent hidden items');
    expect(instructions).toContain('Choose the target position from the actual observed pane');
    expect(instructions).toContain('label the answer partial');
  });
});
