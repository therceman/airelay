import { Terminal } from '@xterm/headless';
import type { IBuffer, IBufferCell } from '@xterm/headless';
import { LIVE_PRESENTATION_RESET, SessionController } from '../src/controller';
import { serializeTerminalPresentation } from '../src/controller/presentation';
import { useTestEnv } from './test-utils';

useTestEnv();

const flushTerminal = (terminal: Terminal): Promise<void> =>
  new Promise((resolve) => terminal.write('', resolve));

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
    synchronizedOutputMode: modes.synchronizedOutputMode,
    wraparoundMode: modes.wraparoundMode,
  };
}

async function write(terminal: Terminal, data: string): Promise<void> {
  terminal.write(data);
  await flushTerminal(terminal);
}

function createTerminal(cols = 80, rows = 6): Terminal {
  return new Terminal({ cols, rows, allowProposedApi: true, scrollback: 20 });
}

describe('controller resume presentation serialization', () => {
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

    const serialized = serializeTerminalPresentation(source, LIVE_PRESENTATION_RESET);
    await write(destination, serialized);

    expect(serialized).toContain('38;5;123');
    expect(serialized).toContain('38;2;1;2;3');
    expect(serialized).toContain('48;5;25');
    expect(serialized).toContain('48;2;9;8;7');
    expect(serialized).toContain('38;5;10');
    expect(serialized).toContain('48;5;11');
    expect(serialized).toContain('39;49');
    expect(serialized).toContain('\x1b[1;');
    expect(serialized).toContain('\x1b[2;');
    expect(serialized).toContain('\x1b[3;');
    expect(serialized).toContain('\x1b[4;');
    expect(serialized).toContain(';7;');
    expect(snapshotTerminal(destination)).toEqual(snapshotTerminal(source));
    expect(destination.buffer.active.cursorY).toBe(source.buffer.active.cursorY);
    expect(destination.buffer.active.cursorX).toBe(source.buffer.active.cursorX);
  });

  it('preserves wide and combined characters without duplicating continuation cells', async () => {
    const source = createTerminal(20, 3);
    const destination = createTerminal(20, 3);
    await write(source, '\x1b[1;1H界e\u0301\x1b[3;8H');

    await write(destination, serializeTerminalPresentation(source, LIVE_PRESENTATION_RESET));

    expect(snapshotTerminal(destination)).toEqual(snapshotTerminal(source));
    expect(readCell(destination.buffer.active, 0, 0).getChars()).toBe('界');
    expect(readCell(destination.buffer.active, 0, 1).getWidth()).toBe(0);
    expect(readCell(destination.buffer.active, 0, 2).getChars()).toBe('e\u0301');
  });

  it('retains trailing styled spaces and explicitly clears empty rows', async () => {
    const source = createTerminal(12, 3);
    const destination = createTerminal(12, 3);
    await write(source, '\x1b[1;1Htext\x1b[48;5;25m   \x1b[0m\x1b[3;1Hlast-row');
    await write(destination, 'OLD-ROW-1\r\nOLD-ROW-2\r\nOLD-ROW-3');

    await write(destination, serializeTerminalPresentation(source, LIVE_PRESENTATION_RESET));

    const buffer = destination.buffer.active;
    expect(buffer.getLine(buffer.viewportY)?.translateToString(true)).toBe('text   ');
    expect(buffer.getLine(buffer.viewportY + 1)?.translateToString(true)).toBe('');
    expect(buffer.getLine(buffer.viewportY + 2)?.translateToString(true)).toBe('last-row');
    expect(readCell(buffer, buffer.viewportY, 4).isBgPalette()).toBe(true);
    expect(readCell(buffer, buffer.viewportY, 4).getBgColor()).toBe(25);
    expect(buffer.baseY).toBe(0);
    expect(buffer.cursorY).toBe(2);
    expect(buffer.cursorX).toBe(8);
  });

  it('restores every mode exposed by the installed public Terminal.modes API', async () => {
    const source = createTerminal();
    const destination = createTerminal();
    await write(
      source,
      '\x1b[?1h\x1b[?66h\x1b[?2004h\x1b[4h\x1b[?6h\x1b[?45h' +
        '\x1b[?1004h\x1b[?1002h\x1b[?7l\x1b[?2026h'
    );

    await write(destination, serializeTerminalPresentation(source, LIVE_PRESENTATION_RESET));

    expect(snapshotModes(destination)).toEqual(snapshotModes(source));
  });

  it('clears and paints the final row without scrolling or appending a newline', async () => {
    const source = createTerminal(12, 3);
    const destination = createTerminal(12, 3);
    await write(source, '\x1b[3;1Hfinal');
    await write(destination, 'old-1\r\nold-2\r\nold-3');

    const serialized = serializeTerminalPresentation(source, LIVE_PRESENTATION_RESET);
    await write(destination, serialized);

    expect(serialized.endsWith('\n')).toBe(false);
    expect(destination.buffer.active.baseY).toBe(0);
    expect(destination.buffer.active.cursorY).toBe(source.buffer.active.cursorY);
    expect(destination.buffer.active.cursorX).toBe(source.buffer.active.cursorX);
    expect(destination.buffer.active.getLine(0)?.translateToString(true)).toBe('');
    expect(destination.buffer.active.getLine(2)?.translateToString(true)).toBe('final');
  });

  it('serializes only the current viewport and never replays scrollback', async () => {
    const source = createTerminal(20, 3);
    const destination = createTerminal(20, 3);
    await write(
      source,
      'HISTORY-1\r\nHISTORY-2\r\nHISTORY-3\r\nVISIBLE-1\r\nVISIBLE-2\r\nVISIBLE-3'
    );

    const serialized = serializeTerminalPresentation(source, LIVE_PRESENTATION_RESET);
    await write(destination, serialized);

    expect(serialized).not.toContain('HISTORY-1');
    expect(serialized).not.toContain('HISTORY-2');
    expect(destination.buffer.active.getLine(0)?.translateToString(true)).toBe('VISIBLE-1');
    expect(destination.buffer.active.getLine(1)?.translateToString(true)).toBe('VISIBLE-2');
    expect(destination.buffer.active.getLine(2)?.translateToString(true)).toBe('VISIBLE-3');
  });

  it('exposes the styled serializer through SessionController', async () => {
    const controller = new SessionController('presentation_controller_boundary');
    const destination = createTerminal(20, 3);
    try {
      controller.resize(20, 3);
      controller.feedOutput('\x1b[31mcontroller-red\x1b[0m');
      await controller.flushViewport();

      const serialized = controller.serializeLivePresentation();
      await write(destination, serialized);

      expect(serialized).toContain('38;5;1');
      expect(destination.buffer.active.getLine(0)?.translateToString(true)).toBe('controller-red');
      expect(readCell(destination.buffer.active, 0, 0).isFgPalette()).toBe(true);
      expect(readCell(destination.buffer.active, 0, 0).getFgColor()).toBe(1);
    } finally {
      await controller.stop();
    }
  });
});
