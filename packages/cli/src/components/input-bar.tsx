import { useRef, useState, useEffect } from 'react';
import type { KeyBinding } from '@opentui/core';
import type { TextareaRenderable } from '@opentui/core';
import { EmptyBorder } from './border';
import { StatusBar } from './satus-bar';

type Props = {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  onCommand?: (command: string) => void;
};

// Command prefix
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
  const [isCommandMode, setIsCommandMode] = useState(false);

  // Check if input is a command
  useEffect(() => {
    setIsCommandMode(inputValue.startsWith(COMMAND_PREFIX));
  }, [inputValue]);

  const handleSubmit = () => {
    const text = textareaRef.current?.editBuffer.getText() ?? '';
    
    if (!text.trim()) return;

    // Check if it's a command
    if (text.startsWith(COMMAND_PREFIX)) {
      const command = text.slice(1).trim();
      if (onCommand) {
        onCommand(command);
      }
      // Clear input after command
      setInputValue('');
      if (textareaRef.current) {
        textareaRef.current.editBuffer.setText('');
      }
      return;
    }

    // Regular message submission
    onSubmit(text);
    setInputValue('');
  };

  return (
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
            onSubmit={handleSubmit}
            placeholder={isCommandMode ? `Enter command (e.g., /new, /help)` : `Ask anything ... "Fix a bug in the database"`}
          />
          <StatusBar />
        </box>
      </box>
    </box>
  );
}
