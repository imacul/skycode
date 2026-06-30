import { useRef } from 'react';
import type { KeyBinding } from '@opentui/core';
import type { TextareaRenderable } from '@opentui/core';
import { EmptyBorder } from './border';
import { StatusBar } from './satus-bar';

type Props = {
  onSubmit: (text: string) => void;
  disabled?: boolean;
};

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

export function InputBar({ onSubmit, disabled = false }: Props) {
  const textareaRef = useRef<TextareaRenderable | null>(null);

  const handleSubmit = () => {
    const text = textareaRef.current?.editBuffer.getText() ?? '';
    onSubmit(text);
  };

  return (
    <box width="100%" alignItems="center">
      <box border={['left']} borderColor="cyan" width="100%">
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
            placeholder={`Ask anything ... "Fix a bug in the database"`}
          />
          <StatusBar />
        </box>
      </box>
    </box>
  );
}
