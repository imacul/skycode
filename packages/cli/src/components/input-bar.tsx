import { useMemo, useRef, useState } from 'react';
import type { KeyBinding, KeyEvent, TextareaRenderable } from '@opentui/core';
import { StatusBar } from './satus-bar';
import { SLASH_COMMANDS } from '../utils/slash-commands';

type Props = {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  onCommand?: (command: string) => void;
};

const COMMAND_PREFIX = '/';

export const TEXTAREA_KEY_BINDINGS: KeyBinding[] = [
  { name: 'return', action: 'submit' },
  { name: 'enter', action: 'submit' },
  { name: 'kpenter', action: 'submit' },
  { name: 'return', shift: true, action: 'newline' },
  { name: 'enter', shift: true, action: 'newline' },
  { name: 'kpenter', shift: true, action: 'newline' },
  { name: 'linefeed', shift: true, action: 'newline' },
  { name: 'return', ctrl: true, action: 'submit' },
  { name: 'enter', ctrl: true, action: 'submit' },
  { name: 'kpenter', ctrl: true, action: 'submit' },
  { name: 'return', meta: true, action: 'submit' },
  { name: 'enter', meta: true, action: 'submit' },
  { name: 'kpenter', meta: true, action: 'submit' },
];

export function InputBar({ onSubmit, disabled = false, onCommand }: Props) {
  const textareaRef = useRef<TextareaRenderable | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [pickerDismissed, setPickerDismissed] = useState(false);

  const isCommandMode = inputValue.startsWith(COMMAND_PREFIX);
  const commandToken = inputValue.trimStart().split(/\s+/)[0] || '';

  const filteredCommands = useMemo(() => {
    if (!isCommandMode) return [];
    const query = commandToken.toLowerCase();
    return SLASH_COMMANDS.filter((item) => item.command.startsWith(query));
  }, [commandToken, isCommandMode]);

  const hasCommandArguments = /^\/\S+\s/.test(inputValue);
  const showCommandPicker =
    !disabled &&
    !pickerDismissed &&
    isCommandMode &&
    !hasCommandArguments &&
    filteredCommands.length > 0;

  const selectedCommand =
    filteredCommands[Math.min(selectedCommandIndex, Math.max(0, filteredCommands.length - 1))];

  const replaceInput = (value: string) => {
    const textarea = textareaRef.current;
    setInputValue(value);
    setPickerDismissed(false);

    if (!textarea) return;
    textarea.editBuffer.setText(value);
    textarea.cursorOffset = value.length;
  };

  const applySelectedCommand = (command = selectedCommand) => {
    if (!command) return;
    replaceInput(command.takesArgs ? `${command.command} ` : command.command);
  };

  const handleContentChange = () => {
    const value = textareaRef.current?.editBuffer.getText() ?? '';
    setInputValue(value);
    setSelectedCommandIndex(0);
    setPickerDismissed(false);
  };

  const handleKeyDown = (key: KeyEvent) => {
    if (!showCommandPicker) {
      if (key.name === 'escape' && isCommandMode) {
        setPickerDismissed(true);
      }
      return;
    }

    if (key.name === 'escape') {
      setPickerDismissed(true);
      key.preventDefault();
      key.stopPropagation();
      return;
    }

    if (key.name === 'up') {
      setSelectedCommandIndex((index) =>
        (index - 1 + filteredCommands.length) % filteredCommands.length
      );
      key.preventDefault();
      key.stopPropagation();
      return;
    }

    if (key.name === 'down') {
      setSelectedCommandIndex((index) => (index + 1) % filteredCommands.length);
      key.preventDefault();
      key.stopPropagation();
      return;
    }

    if (key.name === 'tab') {
      applySelectedCommand();
      key.preventDefault();
      key.stopPropagation();
      return;
    }

    if (
      (key.name === 'return' || key.name === 'enter' || key.name === 'kpenter') &&
      selectedCommand &&
      inputValue.trim() !== selectedCommand.command
    ) {
      applySelectedCommand();
      key.preventDefault();
      key.stopPropagation();
    }
  };

  const clearInput = () => {
    setInputValue('');
    setSelectedCommandIndex(0);
    setPickerDismissed(false);
    if (textareaRef.current) {
      textareaRef.current.editBuffer.setText('');
      textareaRef.current.cursorOffset = 0;
    }
  };

  const handleSubmit = () => {
    const text = textareaRef.current?.editBuffer.getText() ?? '';

    if (!text.trim()) return;

    if (text.startsWith(COMMAND_PREFIX)) {
      const command = text.trim();
      onCommand?.(command);
      clearInput();
      return;
    }

    onSubmit(text);
    clearInput();
  };

  return (
    <box width="100%" flexDirection="column">
      {showCommandPicker && (
        <box
          width="100%"
          flexDirection="column"
          backgroundColor="#12121A"
          border={['top', 'left', 'right']}
          borderColor="magenta"
          paddingX={1}
          paddingY={0}
        >
          <text fg="gray" attributes={{ dim: true }}>
            Slash commands · ↑↓ navigate · Tab complete · Enter choose/run
          </text>
          {filteredCommands.map((item, index) => {
            const selected = index === selectedCommandIndex;
            return (
              <box
                key={item.command}
                width="100%"
                flexDirection="row"
                gap={2}
                backgroundColor={selected ? '#2A2033' : '#12121A'}
                paddingX={1}
                onMouseDown={() => applySelectedCommand(item)}
              >
                <text fg={selected ? 'magenta' : 'white'}>{item.command}</text>
                <text fg="gray" attributes={{ dim: !selected }}>
                  {item.description}
                </text>
              </box>
            );
          })}
        </box>
      )}

      <box width="100%" alignItems="center">
        <box border={['left']} borderColor={isCommandMode ? 'magenta' : 'cyan'} width="100%">
          <box
            position="relative"
            justifyContent="center"
            paddingX={2}
            paddingY={1}
            backgroundColor="#1A1A24"
            width="100%"
            gap={1}
          >
            <textarea
              ref={textareaRef}
              focused={!disabled}
              keyBindings={TEXTAREA_KEY_BINDINGS}
              onContentChange={handleContentChange}
              onKeyDown={handleKeyDown}
              onSubmit={handleSubmit}
              placeholder={
                isCommandMode
                  ? 'Type a command or use ↑↓ to choose'
                  : 'Ask anything ... "Fix a bug in the database"'
              }
            />
            <StatusBar />
          </box>
        </box>
      </box>
    </box>
  );
}
