import { SerializeAddon } from '@xterm/addon-serialize';
import { Terminal } from '@xterm/headless';
import type { IBuffer, IBufferCell } from '@xterm/headless';
import { LIVE_PRESENTATION_RESET, SessionController } from '../src/controller';
import { useTestEnv } from './test-utils';

useTestEnv();

const flushTerminal = (terminal: Terminal): Promise<void> =>
  new Promise((resolve) => terminal.write('', resolve));

async function write(terminal: Terminal, data: string): Promise<void> {
  await new Promise<void>((resolve) => terminal.write(data, resolve));
}

function createTerminal(cols = 80, rows = 6): Terminal {
  return new Terminal({ cols, rows, allowProposedApi: true, scrollback: 20 });
}

function readCell(buffer: IBuffer, row: number, column: number): IBufferCell {
  const nullCell = buffer.getNullCell();
  return buffer.getLine(row)?.getCell(column, nullCell) ?? nullCell;
}

function snapshotCell(cell: IBufferCell): Record<string, unknown> {
  const foregroundKind = cell.isFgRGB() ? 'rgb' : cell.isFgPalette() ? 'palette' : 'default';
  const backgroundKind = cell.isBgRGB() ? 'rgb' : cell.isBgPalette() ? 'palette' : 'default';
  return {
    chars: cell.getChars(),
    width: cell.getWidth(),
    fg: { kind: foregroundKind, value: cell.getFgColor() },
    bg: { kind: backgroundKind, value: cell.getBgColor() },
    bold: cell.isBold(),
    dim: cell.isDim(),
    italic: cell.isItalic(),
    underline: cell.isUnderline(),
    blink: cell.isBlink(),
    inverse: cell.isInverse(),
    invisible: cell.isInvisible(),
    strikethrough: cell.isStrikethrough(),
    overline: cell.isOverline(),
  };
}

function snapshotTerminal(terminal: Terminal): Record<string, unknown>[][] {
  const buffer = terminal.buffer.active;
  return Array.from({ length: terminal.rows }, (_, row) =>
    Array.from({ length: terminal.cols }, (_, column) =>
      snapshotCell(readCell(buffer, buffer.viewportY + row, column))
    )
  );
}

function snapshotModes(terminal: Terminal): Record<string, unknown> {
  const modes = terminal.modes;
  return {
    applicationCursorKeysMode: modes.applicationCursorKeysMode,
    applicationKeypadMode: modes.applicationKeypadMode,
    bracketedPasteMode: modes.bracketedPasteMode,
    insertMode: modes.insertMode,
    mouseTrackingMode: modes.mouseTrackingMode,
    originMode: modes.originMode,
    reverseWraparoundMode: modes.reverseWraparoundMode,
    sendFocusMode: modes.sendFocusMode,
    wraparoundMode: modes.wraparoundMode,
  };
}

function createSerializer(terminal: Terminal): SerializeAddon {
  const addon = new SerializeAddon();
  terminal.loadAddon(addon);
  return addon;
}

function serializePresentation(terminal: Terminal): string {
  const addon = createSerializer(terminal);
  return LIVE_PRESENTATION_RESET + addon.serialize({ scrollback: 0 });
}

async function restore(source: Terminal, destination: Terminal): Promise<string> {
  const serialized = serializePresentation(source);
  await write(destination, serialized);
  return serialized;
}

describe('controller resume presentation serialization', () => {
  it('loads the official SerializeAddon into headless xterm under Node', async () => {
    const terminal = createTerminal(20, 3);
    const addon = createSerializer(terminal);
    await write(terminal, 'node-compatible');

    expect(addon.serialize({ scrollback: 0 })).toContain('node-compatible');
    terminal.dispose();
  });

  it('round-trips styled cells, palette colors, RGB colors, and cursor state', async () => {
    const source = createTerminal();
    const destination = createTerminal();
    await write(
      source,
      '\x1b[1;1H' +
        '\x1b[31mred\x1b[0m ' +
        '\x1b[38;5;123mindexed\x1b[0m ' +
        '\x1b[38;2;1;2;3mtruecolor\x1b[0m ' +
        '\x1b[48;5;25mindexed-bg\x1b[0m ' +
        '\x1b[48;2;9;8;7mrgb-bg\x1b[0m ' +
        '\x1b[1mbold\x1b[22m ' +
        '\x1b[2mdim\x1b[22m ' +
        '\x1b[3mitalic\x1b[23m ' +
        '\x1b[4munderline\x1b[24m ' +
        '\x1b[5mblink\x1b[25m ' +
        '\x1b[7minverse\x1b[27m ' +
        '\x1b[8minvisible\x1b[28m ' +
        '\x1b[9mstrike\x1b[29m ' +
        '\x1b[53moverline\x1b[55m' +
        '\x1b[2;1H\x1b[92mbright-fg\x1b[0m \x1b[103mbright-bg\x1b[0m' +
        '\x1b[6;12H'
    );

    await restore(source, destination);

    expect(snapshotTerminal(destination)).toEqual(snapshotTerminal(source));
    expect(destination.buffer.active.cursorY).toBe(source.buffer.active.cursorY);
    expect(destination.buffer.active.cursorX).toBe(source.buffer.active.cursorX);
  });

  it('retains wide and combined characters without duplicating continuation cells', async () => {
    const source = createTerminal(20, 3);
    const destination = createTerminal(20, 3);
    await write(source, '\x1b[1;1H\u754ce\u0301\x1b[3;8H');

    await restore(source, destination);

    expect(snapshotTerminal(destination)).toEqual(snapshotTerminal(source));
    expect(readCell(destination.buffer.active, 0, 0).getChars()).toBe('\u754c');
    expect(readCell(destination.buffer.active, 0, 1).getWidth()).toBe(0);
    expect(readCell(destination.buffer.active, 0, 2).getChars()).toBe('e\u0301');
  });

  it('retains trailing styled spaces and explicitly clears empty rows', async () => {
    const source = createTerminal(12, 3);
    const destination = createTerminal(12, 3);
    await write(source, '\x1b[1;1Htext\x1b[48;5;25m   \x1b[0m\x1b[3;1Hlast-row');
    await write(destination, 'OLD-ROW-1\r\nOLD-ROW-2\r\nOLD-ROW-3');

    await restore(source, destination);

    expect(snapshotTerminal(destination)).toEqual(snapshotTerminal(source));
    expect(readCell(destination.buffer.active, 0, 4).getBgColor()).toBe(25);
    expect(destination.buffer.active.baseY).toBe(0);
    expect(destination.buffer.active.cursorY).toBe(2);
    expect(destination.buffer.active.cursorX).toBe(8);
  });

  it('round-trips full-width palette background rows, including blank cells', async () => {
    const source = createTerminal(128, 5);
    const destination = createTerminal(128, 5);
    const prompt = '\u203a hey';
    const input = '\u203a Ask Codex to do anything';

    await write(
      source,
      '\x1b[1;1H\x1b[48;5;236m' +
        prompt +
        ' '.repeat(128 - prompt.length) +
        '\x1b[3;1H' +
        input +
        ' '.repeat(128 - input.length) +
        '\x1b[5;1H\x1b[38;5;11mstatus\x1b[0m'
    );

    const sourcePromptBackground = readCell(source.buffer.active, 0, 127);
    const sourceInputBackground = readCell(source.buffer.active, 2, 127);
    expect(sourcePromptBackground.isBgPalette()).toBe(true);
    expect(sourcePromptBackground.getBgColor()).toBe(236);
    expect(sourceInputBackground.isBgPalette()).toBe(true);
    expect(sourceInputBackground.getBgColor()).toBe(236);

    await write(destination, 'old content\r\n'.repeat(5));
    await restore(source, destination);

    expect(snapshotTerminal(destination)).toEqual(snapshotTerminal(source));
    expect(readCell(destination.buffer.active, 0, 127).getBgColor()).toBe(236);
    expect(readCell(destination.buffer.active, 2, 127).getBgColor()).toBe(236);
    expect(readCell(destination.buffer.active, 1, 0).isBgDefault()).toBe(true);
    expect(readCell(destination.buffer.active, 4, 0).getFgColor()).toBe(11);
  });

  it('preserves BCE-erased background cells and does not leak styles between rows', async () => {
    const source = createTerminal(128, 3);
    const destination = createTerminal(128, 3);

    await write(source, '\x1b[1;1H\x1b[48;5;236m\x1b[2K\x1b[1;1H\x1b[0mBCE row');
    expect(readCell(source.buffer.active, 0, 127).getBgColor()).toBe(236);
    await write(source, '\x1b[2;1H\x1b[0m');
    await write(destination, '\x1b[48;5;25mstale row\r\nmore stale\r\n');

    await restore(source, destination);

    expect(snapshotTerminal(destination)).toEqual(snapshotTerminal(source));
    expect(readCell(destination.buffer.active, 1, 0).isBgDefault()).toBe(true);
  });

  it('preserves inverse default colors across a full-width row', async () => {
    const source = createTerminal(24, 2);
    const destination = createTerminal(24, 2);

    await write(source, '\x1b[1;1H\x1b[7mINVERSE' + ' '.repeat(17));
    await restore(source, destination);

    expect(snapshotTerminal(destination)).toEqual(snapshotTerminal(source));
    expect(readCell(destination.buffer.active, 0, 23).isInverse()).not.toBe(0);
  });

  it('restores the public modes supported by SerializeAddon', async () => {
    const source = createTerminal();
    const destination = createTerminal();
    await write(
      source,
      '\x1b[?1h\x1b[?66h\x1b[?2004h\x1b[4h\x1b[?6h\x1b[?45h' + '\x1b[?1004h\x1b[?1002h\x1b[?7l'
    );

    await restore(source, destination);

    expect(snapshotModes(destination)).toEqual(snapshotModes(source));
  });

  it('keeps synchronized output out of the parity contract because the addon documents it as temporary', async () => {
    const source = createTerminal();
    const destination = createTerminal();
    await write(source, '\x1b[?2026h');

    await restore(source, destination);

    expect(source.modes.synchronizedOutputMode).toBe(true);
    expect(destination.modes.synchronizedOutputMode).toBe(false);
  });

  it('clears and paints the final row without scrolling or appending a newline', async () => {
    const source = createTerminal(12, 3);
    const destination = createTerminal(12, 3);
    await write(source, '\x1b[3;1Hfinal');
    await write(destination, 'old-1\r\nold-2\r\nold-3');

    const serialized = await restore(source, destination);

    expect(serialized.endsWith('\n')).toBe(false);
    expect(destination.buffer.active.baseY).toBe(0);
    expect(destination.buffer.active.cursorY).toBe(source.buffer.active.cursorY);
    expect(destination.buffer.active.cursorX).toBe(source.buffer.active.cursorX);
    expect(destination.buffer.active.getLine(0)?.translateToString(true)).toBe('');
    expect(destination.buffer.active.getLine(2)?.translateToString(true)).toBe('final');
  });

  it('serializes only the current viewport and excludes historical scrollback', async () => {
    const source = createTerminal(40, 5);
    const destination = createTerminal(40, 5);
    await write(
      source,
      Array.from({ length: 30 }, (_, index) => 'OLD_HISTORY_SHOULD_NOT_APPEAR_' + index).join(
        '\r\n'
      ) + '\x1b[2J\x1b[H\x1b[38;5;10mCURRENT_VIEW\x1b[0m'
    );

    const serialized = await restore(source, destination);

    expect(serialized).not.toContain('OLD_HISTORY_SHOULD_NOT_APPEAR_');
    expect(destination.buffer.active.getLine(0)?.translateToString(true)).toBe('CURRENT_VIEW');
    expect(destination.buffer.active.baseY).toBe(0);
  });

  it('preserves active SGR for an unstyled continuation after the snapshot', async () => {
    const source = createTerminal(30, 4);
    const destination = createTerminal(30, 4);
    await write(source, '\x1b[48;5;236m\x1b[38;2;1;2;3m\x1b[1m\x1b[2;5H');

    await restore(source, destination);
    await write(source, 'X');
    await write(destination, 'X');

    expect(snapshotTerminal(destination)).toEqual(snapshotTerminal(source));
    expect(readCell(destination.buffer.active, 1, 4).getBgColor()).toBe(236);
    expect(readCell(destination.buffer.active, 1, 4).getFgColor()).toBe(0x010203);
    expect(readCell(destination.buffer.active, 1, 4).isBold()).not.toBe(0);
  });

  it('keeps a Codex-like prompt, input, body, and footer visually equivalent', async () => {
    const source = createTerminal(140, 8);
    const destination = createTerminal(140, 8);
    const prompt = '\u203a hey';
    const input = '\u203a Ask Codex to do anything';
    await write(
      source,
      '\x1b[1;1H\x1b[48;5;236m' +
        prompt +
        ' '.repeat(140 - prompt.length) +
        '\x1b[3;1H' +
        input +
        ' '.repeat(140 - input.length) +
        '\x1b[5;1H\x1b[38;5;11mToken usage: total=4,491\x1b[0m' +
        '\x1b[6;1H\x1b[38;2;80;180;255mfooter\x1b[0m\x1b[8;17H'
    );

    await write(destination, 'stale destination content');
    await restore(source, destination);

    expect(snapshotTerminal(destination)).toEqual(snapshotTerminal(source));
    expect(readCell(destination.buffer.active, 0, 139).getBgColor()).toBe(236);
    expect(readCell(destination.buffer.active, 2, 139).getBgColor()).toBe(236);
    expect(readCell(destination.buffer.active, 4, 0).getFgColor()).toBe(11);
  });

  it('restores the active alternate buffer without forcing normal-buffer semantics', async () => {
    const source = createTerminal(30, 4);
    const destination = createTerminal(30, 4);
    await write(source, 'normal history\x1b[?1049h\x1b[2;3H\x1b[32malternate\x1b[0m');

    await restore(source, destination);

    expect(source.buffer.active.type).toBe('alternate');
    expect(destination.buffer.active.type).toBe('alternate');
    expect(snapshotTerminal(destination)).toEqual(snapshotTerminal(source));
  });

  it('keeps source and destination equivalent through live cursor and erase updates', async () => {
    const source = createTerminal(40, 4);
    const destination = createTerminal(40, 4);
    await write(source, '\x1b[1;1H\x1b[48;5;236mPROMPT' + ' '.repeat(34));
    await restore(source, destination);

    const continuations = [
      '\x1b[2;1H\x1b[2K\x1b[38;2;1;2;3mupdated\x1b[0m',
      '\x1b[3;1H\x1b[1D!\x1b[K',
      '\x1b[4;1H\x1b[38;5;11mfooter update\x1b[0m',
    ];
    for (const continuation of continuations) {
      await write(source, continuation);
      await write(destination, continuation);
      expect(snapshotTerminal(destination)).toEqual(snapshotTerminal(source));
      expect(destination.buffer.active.cursorY).toBe(source.buffer.active.cursorY);
      expect(destination.buffer.active.cursorX).toBe(source.buffer.active.cursorX);
    }
  });

  it('exposes the official serializer through SessionController', async () => {
    const controller = new SessionController('presentation_controller_boundary');
    const destination = createTerminal(20, 30);
    try {
      controller.resize(20, 30);
      controller.feedOutput('\x1b[48;5;236mcontroller-red\x1b[38;5;1m');
      await controller.flushViewport();

      const serialized = controller.serializeLivePresentation();
      await write(destination, serialized);

      expect(serialized.startsWith(LIVE_PRESENTATION_RESET)).toBe(true);
      expect(destination.buffer.active.getLine(0)?.translateToString(true)).toBe('controller-red');
      expect(readCell(destination.buffer.active, 0, 0).isBgPalette()).toBe(true);
      expect(readCell(destination.buffer.active, 0, 0).getBgColor()).toBe(236);
      expect(readCell(destination.buffer.active, 0, 0).isFgDefault()).toBe(true);
      await write(destination, 'X');
      expect(readCell(destination.buffer.active, 0, 'controller-red'.length).getFgColor()).toBe(1);
      expect(readCell(destination.buffer.active, 0, 'controller-red'.length).getBgColor()).toBe(
        236
      );
    } finally {
      await controller.stop();
    }
  });

  it('keeps presentation reset ordering before the official snapshot', () => {
    expect(LIVE_PRESENTATION_RESET).toBe('\x1b[0m\x1b[H\x1b[2J\x1b[3J\x1b[H');
  });

  it('flushes the terminal before reading the official snapshot', async () => {
    const terminal = createTerminal(20, 3);
    await write(terminal, 'flushed');
    await flushTerminal(terminal);
    const addon = createSerializer(terminal);

    expect(addon.serialize({ scrollback: 0 })).toContain('flushed');
    terminal.dispose();
  });
});
