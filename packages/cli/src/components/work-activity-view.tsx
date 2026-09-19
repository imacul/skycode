import type { AgentActivity } from '../agents/types';

function activitySymbol(activity: AgentActivity): string {
  if (activity.status === 'error') return '✗';
  if (activity.status === 'running') return '•';
  return '✓';
}

function activityColor(activity: AgentActivity): string {
  if (activity.status === 'error') return 'red';
  if (activity.status === 'running') return 'yellow';
  return 'green';
}

export function WorkActivityView({
  activities,
}: {
  activities: AgentActivity[];
}) {
  const visible = activities.slice(-6);

  if (visible.length === 0) return null;

  return (
    <box
      width="100%"
      flexDirection="column"
      backgroundColor="#0D1117"
      border={['left']}
      borderColor="cyan"
      paddingX={1}
      paddingY={0}
      flexShrink={0}
      maxHeight={18}
    >
      <box width="100%" flexDirection="row" justifyContent="space-between">
        <text fg="cyan" attributes={{ bold: true }}>{'Working'}</text>
        <text fg="gray" attributes={{ dim: true }}>
          {String(activities.length) + ' actions'}
        </text>
      </box>

      {visible.map((activity) => (
        <box key={activity.id} width="100%" flexDirection="column">
          <box width="100%" flexDirection="row">
            <text fg={activityColor(activity)}>
              {activitySymbol(activity) + ' '}
            </text>
            <text fg="white" attributes={{ bold: activity.status === 'running' }}>
              {String(activity.title)}
            </text>
            {activity.path ? (
              <text fg="cyan">{'  ' + String(activity.path)}</text>
            ) : null}
            {typeof activity.additions === 'number' || typeof activity.deletions === 'number' ? (
              <text fg="gray">
                {'  +' + String(activity.additions || 0) + ' -' + String(activity.deletions || 0)}
              </text>
            ) : null}
          </box>

          {activity.detail ? (
            <text fg="gray" attributes={{ dim: true }} wordWrap="break-word" width="100%">
              {String(activity.detail)}
            </text>
          ) : null}

          {activity.preview && activity.preview.length > 0 ? (
            <box width="100%" flexDirection="column" paddingLeft={2}>
              {activity.preview.slice(0, 8).map((line, index) => (
                <text
                  key={index}
                  fg={line.startsWith('+ ') ? 'green' : line.startsWith('- ') ? 'red' : 'gray'}
                  attributes={{ dim: line === '…' }}
                  wordWrap="break-word"
                  width="100%"
                >
                  {String(line)}
                </text>
              ))}
            </box>
          ) : null}
        </box>
      ))}

      {activities.length > visible.length ? (
        <text fg="gray" attributes={{ dim: true }}>
          {'Showing latest ' + visible.length + ' actions · earlier work is above in the chat log'}
        </text>
      ) : null}
    </box>
  );
}
