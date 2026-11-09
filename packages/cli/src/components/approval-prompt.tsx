import type {
import { TextAttributes } from '@opentui/core';
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
      <text fg="yellow" attributes={TextAttributes.BOLD}>{request.title}</text>
      <text fg="white" width="100%">
        {request.description}
      </text>

      <box width="100%" flexDirection="column" paddingY={1}>
        <text fg="gray" attributes={TextAttributes.DIM}>{'Command'}</text>
        <text fg="cyan" width="100%">
          {request.command}
        </text>
      </box>

      <text fg="gray" attributes={TextAttributes.DIM}>
        {'Choose once, for this session, always for this permission family, or deny.'}
      </text>

      <box width="100%" flexDirection="row" gap={2} paddingTop={1}>
        <text
          fg="green"
          attributes={TextAttributes.BOLD | TextAttributes.UNDERLINE}
          onMouseDown={() => onDecision('once')}
        >{'[1] Allow once'}</text>

        <text
          fg="cyan"
          attributes={TextAttributes.BOLD | TextAttributes.UNDERLINE}
          onMouseDown={() => onDecision('session')}
        >{'[2] Allow session'}</text>

        <text
          fg="magenta"
          attributes={TextAttributes.BOLD | TextAttributes.UNDERLINE}
          onMouseDown={() => onDecision('always')}
        >{'[3] Always allow'}</text>

        <text
          fg="red"
          attributes={TextAttributes.BOLD | TextAttributes.UNDERLINE}
          onMouseDown={() => onDecision('deny')}
        >{'[4] Deny'}</text>
      </box>

      <text fg="gray" attributes={TextAttributes.DIM}>
        {'Keyboard: press 1, 2, 3, or 4 while this approval is open.'}
      </text>
    </box>
  );
}
