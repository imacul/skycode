import { TextAttributes } from '@opentui/core';
import { useSettingsStore } from '../store/settings';

export function StatusBar() {
  const { model: modelSettings } = useSettingsStore();
  const currentModel = modelSettings.defaultModel || 'meta-llama/llama-3.1-70b-instruct';

  // Extract short name from model ID
  const getModelName = (modelId: string): string => {
    // Remove provider prefix
    let name = modelId;
    if (name.includes('/')) {
      name = name.split('/').pop() || name;
    }
    // Remove version suffix
    name = name.replace(/-\d+[bB]?$/, '');
    name = name.replace(/-instruct$/, '');
    name = name.replace(/-it$/, '');
    return name;
  };

  return (
    <box flexDirection="row" gap={1}>
      <text fg="cyan">Model</text>
      <text attributes={TextAttributes.DIM} fg="gray">
        \u203a
      </text>
      <text fg="white">{getModelName(currentModel)}</text>
    </box>
  );
}
