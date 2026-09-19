export type RichBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'bullet'; text: string; ordered: boolean; index?: number }
  | { type: 'quote'; text: string }
  | { type: 'divider' }
  | { type: 'code'; language: string; code: string }
  | { type: 'writing'; text: string };

type TokenKind = 'plain' | 'keyword' | 'string' | 'number' | 'comment' | 'type';

type CodeToken = {
  text: string;
  kind: TokenKind;
};

const KEYWORDS = new Set([
  'abstract','async','await','break','case','catch','class','const','continue','def','default',
  'delete','do','else','enum','export','extends','false','finally','for','from','function','if',
  'implements','import','in','instanceof','interface','let','new','None','null','package','private',
  'protected','public','raise','return','static','struct','super','switch','this','throw','true',
  'try','type','typeof','undefined','var','void','while','with','yield','fn','impl','match','mut',
  'pub','use','mod','trait','where','self','Self','go','defer','func','map','range','chan','select',
  'namespace','using','record','sealed','virtual','override','readonly','partial','internal','async',
  'Task','var','val','fun','object','data','when','suspend','package','lambda','elif','except',
]);

const TYPE_WORDS = new Set([
  'string','number','boolean','any','unknown','never','void','object','String','Number','Boolean',
  'Array','Record','Promise','Error','Date','Map','Set','int','float','double','char','bool','long',
  'short','byte','usize','isize','u8','u16','u32','u64','i8','i16','i32','i64','f32','f64',
]);

function normalizeLanguage(value: string): string {
  const lang = value.trim().toLowerCase();
  const aliases: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    sh: 'bash',
    shell: 'bash',
    yml: 'yaml',
    md: 'markdown',
    cs: 'csharp',
    'c#': 'csharp',
    cpp: 'cpp',
    'c++': 'cpp',
  };
  return aliases[lang] || lang || 'text';
}

export function parseRichResponse(content: string): RichBlock[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const blocks: RichBlock[] = [];
  let paragraph: string[] = [];
  let inFence = false;
  let fenceLanguage = '';
  let fenceLines: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(' ').trim();
    if (text) blocks.push({ type: 'paragraph', text });
    paragraph = [];
  };

  const flushFence = () => {
    const language = normalizeLanguage(fenceLanguage);
    const code = fenceLines.join('\n').replace(/\s+$/, '');
    if (language === 'writing' || language === 'draft') {
      blocks.push({ type: 'writing', text: code });
    } else {
      blocks.push({ type: 'code', language, code });
    }
    fenceLanguage = '';
    fenceLines = [];
  };

  for (const line of lines) {
    const fence = line.match(/^\s*```([^\s`]*)\s*$/);
    if (fence) {
      if (inFence) {
        flushFence();
        inFence = false;
      } else {
        flushParagraph();
        inFence = true;
        fenceLanguage = fence[1] || 'text';
      }
      continue;
    }

    if (inFence) {
      fenceLines.push(line);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const heading = line.match(/^\s*(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
      continue;
    }

    if (/^\s*(---+|___+|\*\*\*+)\s*$/.test(line)) {
      flushParagraph();
      blocks.push({ type: 'divider' });
      continue;
    }

    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      blocks.push({ type: 'bullet', text: unordered[1].trim(), ordered: false });
      continue;
    }

    const ordered = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      blocks.push({
        type: 'bullet',
        text: ordered[2].trim(),
        ordered: true,
        index: Number(ordered[1]),
      });
      continue;
    }

    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      blocks.push({ type: 'quote', text: quote[1].trim() });
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  if (inFence) flushFence();

  return blocks;
}

export function tokenizeCodeLine(line: string, language: string): CodeToken[] {
  const lang = normalizeLanguage(language);
  const trimmed = line.trimStart();

  const commentPrefix =
    lang === 'python' || lang === 'ruby' || lang === 'bash' || lang === 'yaml'
      ? '#'
      : lang === 'sql'
        ? '--'
        : '//';

  if (trimmed.startsWith(commentPrefix)) {
    return [{ text: line, kind: 'comment' }];
  }

  const tokens: CodeToken[] = [];
  const tokenRe = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b|\s+|.)/g;
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(line)) !== null) {
    const text = match[0];
    let kind: TokenKind = 'plain';

    if (/^["'`]/.test(text)) kind = 'string';
    else if (/^\d/.test(text)) kind = 'number';
    else if (KEYWORDS.has(text)) kind = 'keyword';
    else if (TYPE_WORDS.has(text) || /^[A-Z][A-Za-z0-9_$]*$/.test(text)) kind = 'type';

    tokens.push({ text, kind });
  }

  return tokens.length > 0 ? tokens : [{ text: line, kind: 'plain' }];
}

function tokenColor(kind: TokenKind): string {
  switch (kind) {
    case 'keyword':
      return 'magenta';
    case 'string':
      return 'green';
    case 'number':
      return 'yellow';
    case 'comment':
      return 'gray';
    case 'type':
      return 'cyan';
    default:
      return 'white';
  }
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const lines = code.split('\n');
  const gutterWidth = String(Math.max(1, lines.length)).length;

  return (
    <box
      width="100%"
      flexDirection="column"
      backgroundColor="#0D1117"
      border={['left', 'right', 'top', 'bottom']}
      borderColor="gray"
      paddingX={1}
      paddingY={0}
    >
      <box width="100%" flexDirection="row" justifyContent="space-between">
        <text fg="cyan" attributes={{ bold: true }}>{String(language || 'text')}</text>
        <text fg="gray" attributes={{ dim: true }}>{String(lines.length) + ' lines'}</text>
      </box>

      {lines.map((line, index) => (
        <box key={index} width="100%" flexDirection="row">
          <text fg="gray" attributes={{ dim: true }}>
            {String(index + 1).padStart(gutterWidth, ' ') + ' │ '}
          </text>
          {tokenizeCodeLine(line, language).map((token, tokenIndex) => (
            <text
              key={tokenIndex}
              fg={tokenColor(token.kind)}
              attributes={{ dim: token.kind === 'comment' }}
            >{token.text || ' '}</text>
          ))}
        </box>
      ))}
    </box>
  );
}

function WritingBlock({ text }: { text: string }) {
  return (
    <box
      width="100%"
      flexDirection="column"
      backgroundColor="#15131D"
      border={['left']}
      borderColor="magenta"
      paddingX={2}
      paddingY={1}
    >
      <text fg="magenta" attributes={{ bold: true }}>{'Writing'}</text>
      <text fg="white" wordWrap="break-word" width="100%">{text}</text>
    </box>
  );
}

export function ResponseContent({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}) {
  const blocks = parseRichResponse(content);

  return (
    <box width="100%" flexDirection="column" gap={1}>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'heading':
            return (
              <text
                key={index}
                fg={block.level <= 2 ? 'cyan' : 'white'}
                attributes={{ bold: true }}
                wordWrap="break-word"
                width="100%"
              >{block.text}</text>
            );

          case 'bullet':
            return (
              <box key={index} width="100%" flexDirection="row">
                <text fg="cyan">{block.ordered ? String(block.index || 1) + '. ' : '• '}</text>
                <text fg="white" wordWrap="break-word" width="100%">{block.text}</text>
              </box>
            );

          case 'quote':
            return (
              <box
                key={index}
                width="100%"
                flexDirection="row"
                border={['left']}
                borderColor="gray"
                paddingX={1}
              >
                <text fg="gray" attributes={{ dim: true }} wordWrap="break-word" width="100%">
                  {block.text}
                </text>
              </box>
            );

          case 'divider':
            return <text key={index} fg="gray" attributes={{ dim: true }}>{'────────────────────────'}</text>;

          case 'code':
            return <CodeBlock key={index} language={block.language} code={block.code} />;

          case 'writing':
            return <WritingBlock key={index} text={block.text} />;

          case 'paragraph':
          default:
            return (
              <text key={index} fg="white" wordWrap="break-word" width="100%">
                {block.text}
              </text>
            );
        }
      })}

      {streaming ? <text fg="cyan">{'▍'}</text> : null}
    </box>
  );
}
