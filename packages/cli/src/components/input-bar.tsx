import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyBinding, KeyEvent, TextareaRenderable } from '@opentui/core';
import { StatusBar } from './satus-bar';
import { SLASH_COMMANDS } from '../utils/slash-commands';
import {
  createModelPickerItems,
  filterModelPickerItems,
  type CatalogModel,
} from '../utils/model-catalog';

type Props = {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  onCommand?: (command: string) => void;
  loadModelCatalog?: () => Promise<CatalogModel[]>;
  currentProvider?: string;
  currentModel?: string;
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

export function InputBar({
  onSubmit,
  disabled = false,
  onCommand,
  loadModelCatalog,
  currentProvider = '',
  currentModel = '',
}: Props) {
  const textareaRef = useRef<TextareaRenderable | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [pickerDismissed, setPickerDismissed] = useState(false);
  const [modelCatalog, setModelCatalog] = useState<CatalogModel[]>([]);
  const [modelCatalogLoaded, setModelCatalogLoaded] = useState(false);
  const [modelCatalogLoading, setModelCatalogLoading] = useState(false);
  const [modelCatalogError, setModelCatalogError] = useState<string | null>(null);
  const [selectedModelIndex, setSelectedModelIndex] = useState(0);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);

  const isCommandMode = inputValue.startsWith(COMMAND_PREFIX);
  const commandToken = inputValue.trimStart().split(/\s+/)[0] || '';
  const isModelPickerMode = modelPickerOpen;
  const rawModelQuery = inputValue.startsWith('/model ')
    ? inputValue.slice('/model '.length).trim()
    : '';
  const modelQuery = rawModelQuery.toLowerCase().startsWith('search ')
    ? rawModelQuery.slice('search '.length).trim()
    : rawModelQuery;

  const modelPickerItems = useMemo(
    () =>
      createModelPickerItems(modelCatalog, {
        provider: currentProvider,
        model: currentModel,
      }),
    [modelCatalog, currentProvider, currentModel]
  );

  const filteredModels = useMemo(
    () => filterModelPickerItems(modelPickerItems, modelQuery, Math.max(1, modelPickerItems.length)),
    [modelPickerItems, modelQuery]
  );

  const MODEL_PICKER_ROWS = 5;
  const modelWindowStart = Math.min(
    Math.max(0, selectedModelIndex - Math.floor(MODEL_PICKER_ROWS / 2)),
    Math.max(0, filteredModels.matches.length - MODEL_PICKER_ROWS)
  );
  const visibleModelRows = filteredModels.matches.slice(
    modelWindowStart,
    modelWindowStart + MODEL_PICKER_ROWS
  );

  const showModelPicker =
    !disabled &&
    !pickerDismissed &&
    modelPickerOpen;

  useEffect(() => {
    if (!showModelPicker || modelCatalogLoaded || !loadModelCatalog) {
      return;
    }

    let cancelled = false;
    setModelCatalogLoading(true);
    setModelCatalogError(null);

    void loadModelCatalog()
      .then((catalog) => {
        if (cancelled) return;
        setModelCatalog(catalog);
        setModelCatalogLoaded(true);
      })
      .catch((error) => {
        if (cancelled) return;
        setModelCatalogError(error instanceof Error ? error.message : String(error));
        setModelCatalogLoaded(true);
      })
      .finally(() => {
        if (!cancelled) setModelCatalogLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [showModelPicker, modelCatalogLoaded, loadModelCatalog]);

  useEffect(() => {
    setSelectedModelIndex(0);
  }, [modelQuery]);


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
    !isModelPickerMode &&
    !hasCommandArguments &&
    filteredCommands.length > 0;

  const selectedCommand =
    filteredCommands[Math.min(selectedCommandIndex, Math.max(0, filteredCommands.length - 1))];

  const selectedModel =
    filteredModels.matches[
      Math.min(selectedModelIndex, Math.max(0, filteredModels.matches.length - 1))
    ];

  const closeModelPicker = () => {
    setModelPickerOpen(false);
    setPickerDismissed(true);
    setSelectedModelIndex(0);
  };

  const replaceInput = (value: string) => {
    const textarea = textareaRef.current;
    setInputValue(value);
    setPickerDismissed(false);

    if (!textarea) return;
    textarea.editBuffer.setText(value);
    textarea.cursorOffset = value.length;
  };

  const openModelPicker = () => {
    setModelPickerOpen(true);
    setPickerDismissed(false);
    setSelectedModelIndex(0);
    replaceInput('/model ');
  };

  const applySelectedCommand = (command = selectedCommand) => {
    if (!command) return;

    if (command.command === '/model') {
      openModelPicker();
      return;
    }

    replaceInput(command.takesArgs ? `${command.command} ` : command.command);
  };

  const applySelectedModel = () => {
    if (!selectedModel) return;
    replaceInput('/model ' + selectedModel.selector);
  };

  const submitSelectedModel = () => {
    if (!selectedModel) return;
    onCommand?.('/model ' + selectedModel.selector);
    clearInput();
  };

  const handleContentChange = () => {
    const value = textareaRef.current?.editBuffer.getText() ?? '';
    setInputValue(value);
    setSelectedCommandIndex(0);
    setPickerDismissed(false);

    if (modelPickerOpen && !value.startsWith('/model')) {
      setModelPickerOpen(false);
    }
  };

  const handleKeyDown = (key: KeyEvent) => {
    if (showModelPicker) {
      if (key.name === 'escape') {
        closeModelPicker();
        key.preventDefault();
        key.stopPropagation();
        return;
      }

      if (key.name === 'up' && filteredModels.matches.length > 0) {
        setSelectedModelIndex((index) =>
          (index - 1 + filteredModels.matches.length) % filteredModels.matches.length
        );
        key.preventDefault();
        key.stopPropagation();
        return;
      }

      if (key.name === 'down' && filteredModels.matches.length > 0) {
        setSelectedModelIndex((index) => (index + 1) % filteredModels.matches.length);
        key.preventDefault();
        key.stopPropagation();
        return;
      }

      if (key.name === 'tab' && selectedModel) {
        applySelectedModel();
        key.preventDefault();
        key.stopPropagation();
        return;
      }

      if (key.name === 'return' || key.name === 'enter' || key.name === 'kpenter') {
        if (selectedModel) submitSelectedModel();
        key.preventDefault();
        key.stopPropagation();
        return;
      }
    }

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
      selectedCommand
    ) {
      if (inputValue.trim() !== selectedCommand.command || selectedCommand.command === '/model') {
        applySelectedCommand();
        key.preventDefault();
        key.stopPropagation();
      }
    }
  };

  const clearInput = () => {
    setInputValue('');
    setSelectedCommandIndex(0);
    setPickerDismissed(false);
    setSelectedModelIndex(0);
    setModelPickerOpen(false);
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

      if (command === '/model') {
        openModelPicker();
        return;
      }

      onCommand?.(command);
      clearInput();
      return;
    }

    onSubmit(text);
    clearInput();
  };

  return (
    <box width="100%" flexDirection="column">
      {showModelPicker && (
        <box
          width="100%"
          maxHeight={16}
          flexDirection="column"
          flexShrink={0}
          backgroundColor="#12121A"
          border={['top', 'left', 'right']}
          borderColor="cyan"
          paddingX={1}
          paddingY={0}
        >
          <box width="100%" flexDirection="row" justifyContent="space-between">
            <text fg="cyan" attributes={{ bold: true }}>
              {'Models' + (!modelCatalogLoading && !modelCatalogError ? ' · ' + filteredModels.total : '')}
            </text>
            <text
              fg="gray"
              attributes={{ dim: true, underline: true }}
              onMouseDown={closeModelPicker}
            >{'Close'}</text>
          </box>
          <text fg="gray" attributes={{ dim: true }}>
            {'Type to filter · ↑↓ browse all · Enter switch · Tab fill · click switch · Esc close'}
          </text>

          {modelCatalogError ? (
            <text fg="red">{String(modelCatalogError)}</text>
          ) : modelCatalogLoading ? (
            <text fg="gray">{'Fetching OpenRouter and local models...'}</text>
          ) : filteredModels.matches.length === 0 ? (
            <text fg="yellow">{'No models match "' + modelQuery + '".'}</text>
          ) : (
            visibleModelRows.map((item, index) => {
              const absoluteIndex = modelWindowStart + index;
              const selected = absoluteIndex === selectedModelIndex;
              return (
                <box
                  key={item.key}
                  width="100%"
                  flexDirection="column"
                  backgroundColor={selected ? '#16303A' : '#12121A'}
                  paddingX={1}
                  paddingY={0}
                  onMouseDown={() => {
                    onCommand?.('/model ' + item.selector);
                    clearInput();
                  }}
                >
                  <box width="100%" flexDirection="row" justifyContent="space-between">
                    <text fg={selected ? 'cyan' : 'white'} attributes={{ bold: selected }}>
                      {String(item.name)}
                    </text>
                    <text fg={item.current ? 'green' : item.local || item.free ? 'green' : 'gray'}>
                      {item.current ? 'CURRENT' : item.local ? 'LOCAL' : item.free ? 'FREE' : 'PAID'}
                    </text>
                  </box>
                  <text fg="gray" attributes={{ dim: true }}>
                    {String(item.meta)}
                  </text>
                </box>
              );
            })
          )}

          {!modelCatalogLoading && !modelCatalogError && filteredModels.total > 0 && (
            <text fg="gray" attributes={{ dim: true }}>
              {'Showing ' +
                (modelWindowStart + 1) +
                '–' +
                Math.min(modelWindowStart + visibleModelRows.length, filteredModels.total) +
                ' of ' +
                filteredModels.total +
                ' · keep typing to narrow the list'}
            </text>
          )}
        </box>
      )}

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
                isModelPickerMode
                  ? 'Type a model name, provider, free, paid, local...'
                  : isCommandMode
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
