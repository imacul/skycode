import type {
  AgentApprovalDecision,
  AgentApprovalRequest,
} from '../agents/types';

export function ApprovalPrompt({
  request,
  onDecision,
}: {
  request: AgentApprovalRequest;
  onDecision: (decision: AgentApprovalDecision) => void;
}) {
  return (
    <box
      width="100%"
      flexDirection="column"
      backgroundColor="#17140F"
      border={['left', 'right', 'top', 'bottom']}
      borderColor="yellow"
      paddingX={1}
      paddingY={1}
      flexShrink={0}
    >
      <text fg="yellow" attributes={{ bold: true }}>{request.title}</text>
      <text fg="white" wordWrap="break-word" width="100%">
        {request.description}
      </text>

      <box width="100%" flexDirection="column" paddingY={1}>
        <text fg="gray" attributes={{ dim: true }}>{'Command'}</text>
        <text fg="cyan" wordWrap="break-word" width="100%">
          {request.command}
        </text>
      </box>

      <text fg="gray" attributes={{ dim: true }}>
        {'Choose once, for this session, always for this permission family, or deny.'}
      </text>

      <box width="100%" flexDirection="row" gap={2} paddingTop={1}>
        <text
          fg="green"
          attributes={{ bold: true, underline: true }}
          onMouseDown={() => onDecision('once')}
        >{'[1] Allow once'}</text>

        <text
          fg="cyan"
          attributes={{ bold: true, underline: true }}
          onMouseDown={() => onDecision('session')}
        >{'[2] Allow session'}</text>

        <text
          fg="magenta"
          attributes={{ bold: true, underline: true }}
          onMouseDown={() => onDecision('always')}
        >{'[3] Always allow'}</text>

        <text
          fg="red"
          attributes={{ bold: true, underline: true }}
          onMouseDown={() => onDecision('deny')}
        >{'[4] Deny'}</text>
      </box>

      <text fg="gray" attributes={{ dim: true }}>
        {'Keyboard: press 1, 2, 3, or 4 while this approval is open.'}
      </text>
    </box>
  );
}
