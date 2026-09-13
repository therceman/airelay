import type { IBufferCell, IBufferLine, IModes, Terminal } from '@xterm/headless';

interface PresentationColor {
  kind: 'default' | 'palette' | 'rgb';
  value: number;
}

interface PresentationStyle {
  foreground: PresentationColor;
  background: PresentationColor;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  blink: boolean;
  inverse: boolean;
  invisible: boolean;
  strikethrough: boolean;
  overline: boolean;
}

const SAFE_RENDER_MODES_RESET =
  '\x1b[?1l\x1b[?66l\x1b[?2004l\x1b[?6l\x1b[?45l\x1b[?1004l' +
  '\x1b[?9l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?2026l\x1b[4l\x1b[?7l';

function getColor(cell: IBufferCell, foreground: boolean): PresentationColor {
  const isRgb = foreground ? cell.isFgRGB() : cell.isBgRGB();
  const isPalette = foreground ? cell.isFgPalette() : cell.isBgPalette();
  const value = foreground ? cell.getFgColor() : cell.getBgColor();

  if (isRgb) return { kind: 'rgb', value };
  if (isPalette) return { kind: 'palette', value };
  return { kind: 'default', value: 0 };
}

function getStyle(cell: IBufferCell): PresentationStyle {
  return {
    foreground: getColor(cell, true),
    background: getColor(cell, false),
    bold: cell.isBold() !== 0,
    dim: cell.isDim() !== 0,
    italic: cell.isItalic() !== 0,
    underline: cell.isUnderline() !== 0,
    blink: cell.isBlink() !== 0,
    inverse: cell.isInverse() !== 0,
    invisible: cell.isInvisible() !== 0,
    strikethrough: cell.isStrikethrough() !== 0,
    overline: cell.isOverline() !== 0,
  };
}

function colorsEqual(left: PresentationColor, right: PresentationColor): boolean {
  return left.kind === right.kind && left.value === right.value;
}

function stylesEqual(left: PresentationStyle, right: PresentationStyle): boolean {
  return (
    colorsEqual(left.foreground, right.foreground) &&
    colorsEqual(left.background, right.background) &&
    left.bold === right.bold &&
    left.dim === right.dim &&
    left.italic === right.italic &&
    left.underline === right.underline &&
    left.blink === right.blink &&
    left.inverse === right.inverse &&
    left.invisible === right.invisible &&
    left.strikethrough === right.strikethrough &&
    left.overline === right.overline
  );
}

function isDefaultStyle(style: PresentationStyle): boolean {
  return (
    style.foreground.kind === 'default' &&
    style.background.kind === 'default' &&
    !style.bold &&
    !style.dim &&
    !style.italic &&
    !style.underline &&
    !style.blink &&
    !style.inverse &&
    !style.invisible &&
    !style.strikethrough &&
    !style.overline
  );
}

function appendColor(codes: string[], color: PresentationColor, foreground: boolean): void {
  if (color.kind === 'default') {
    codes.push(foreground ? '39' : '49');
    return;
  }

  const prefix = foreground ? '38' : '48';
  if (color.kind === 'palette') {
    codes.push(prefix, '5', String(color.value));
    return;
  }

  const red = (color.value >> 16) & 0xff;
  const green = (color.value >> 8) & 0xff;
  const blue = color.value & 0xff;
  codes.push(prefix, '2', String(red), String(green), String(blue));
}

function styleSequence(style: PresentationStyle): string {
  const codes: string[] = ['0'];
  if (style.bold) codes.push('1');
  if (style.dim) codes.push('2');
  if (style.italic) codes.push('3');
  if (style.underline) codes.push('4');
  if (style.blink) codes.push('5');
  if (style.inverse) codes.push('7');
  if (style.invisible) codes.push('8');
  if (style.strikethrough) codes.push('9');
  if (style.overline) codes.push('53');
  appendColor(codes, style.foreground, true);
  appendColor(codes, style.background, false);
  return `\x1b[${codes.join(';')}m`;
}

function modeSequence(modes: IModes): string {
  let result = '';
  if (modes.applicationCursorKeysMode) result += '\x1b[?1h';
  if (modes.applicationKeypadMode) result += '\x1b[?66h';
  if (modes.bracketedPasteMode) result += '\x1b[?2004h';
  if (modes.insertMode) result += '\x1b[4h';
  if (modes.originMode) result += '\x1b[?6h';
  if (modes.reverseWraparoundMode) result += '\x1b[?45h';
  if (modes.sendFocusMode) result += '\x1b[?1004h';
  if (modes.wraparoundMode) result += '\x1b[?7h';
  if (modes.synchronizedOutputMode) result += '\x1b[?2026h';

  const mouseModes: Record<IModes['mouseTrackingMode'], string> = {
    none: '',
    x10: '\x1b[?9h',
    vt200: '\x1b[?1000h',
    drag: '\x1b[?1002h',
    any: '\x1b[?1003h',
  };
  return result + mouseModes[modes.mouseTrackingMode];
}

function getCell(
  line: IBufferLine | undefined,
  column: number,
  nullCell: IBufferCell
): IBufferCell {
  return line?.getCell(column, nullCell) ?? nullCell;
}

function rowHasMaterialContent(
  line: IBufferLine | undefined,
  columns: number,
  nullCell: IBufferCell
): number {
  let last = -1;
  for (let column = 0; column < columns; column += 1) {
    const cell = getCell(line, column, nullCell);
    if (cell.getWidth() === 0) continue;
    const style = getStyle(cell);
    if (cell.getChars().length > 0 || !isDefaultStyle(style)) last = column;
  }
  return last;
}

function serializeRow(
  line: IBufferLine | undefined,
  columns: number,
  nullCell: IBufferCell
): string {
  const lastMaterialColumn = rowHasMaterialContent(line, columns, nullCell);
  if (lastMaterialColumn < 0) return '';

  // Preserve xterm's empty-but-styled cells when a BCE operation reaches the
  // right edge. EL applies the explicitly selected erase attributes without
  // turning those cells into literal spaces.
  let trailingEraseStart = -1;
  if (lastMaterialColumn === columns - 1) {
    const lastCell = getCell(line, lastMaterialColumn, nullCell);
    if (lastCell.getChars().length === 0 && lastCell.getWidth() !== 0) {
      const trailingStyle = getStyle(lastCell);
      trailingEraseStart = lastMaterialColumn;
      for (let column = lastMaterialColumn - 1; column >= 0; column -= 1) {
        const cell = getCell(line, column, nullCell);
        if (
          cell.getWidth() === 0 ||
          cell.getChars().length !== 0 ||
          !stylesEqual(getStyle(cell), trailingStyle)
        ) {
          break;
        }
        trailingEraseStart = column;
      }
    }
  }

  let result = '';
  let activeStyle: PresentationStyle | null = null;
  let text = '';
  const flush = (): void => {
    if (text.length > 0) {
      result += text;
      text = '';
    }
  };

  const textEnd = trailingEraseStart >= 0 ? trailingEraseStart : lastMaterialColumn + 1;
  for (let column = 0; column < textEnd; column += 1) {
    const cell = getCell(line, column, nullCell);
    if (cell.getWidth() === 0) continue;

    const style = getStyle(cell);
    if (!activeStyle || !stylesEqual(activeStyle, style)) {
      flush();
      result += styleSequence(style);
      activeStyle = style;
    }
    text += cell.getChars() || ' ';
  }
  flush();

  if (trailingEraseStart >= 0) {
    const trailingCell = getCell(line, trailingEraseStart, nullCell);
    result += styleSequence(getStyle(trailingCell));
    result += '\x1b[0K';
  }

  return result;
}

/** Serialize the current xterm viewport without replaying historical output. */
export function serializeTerminalPresentation(terminal: Terminal, resetSequence: string): string {
  const buffer = terminal.buffer.active;
  const nullCell = buffer.getNullCell();
  let result = `${resetSequence}${SAFE_RENDER_MODES_RESET}`;

  for (let row = 0; row < terminal.rows; row += 1) {
    const line = buffer.getLine(buffer.viewportY + row);
    // EL uses the current erase attributes, so neutralize them before clearing.
    result += `\x1b[${row + 1};1H\x1b[0m\x1b[2K`;
    result += serializeRow(line, terminal.cols, nullCell);
  }

  result += '\x1b[0m';
  const cursorRow = Math.min(terminal.rows, Math.max(1, buffer.cursorY + 1));
  const cursorColumn = Math.min(terminal.cols, Math.max(1, buffer.cursorX + 1));
  result += `\x1b[${cursorRow};${cursorColumn}H`;
  result += modeSequence(terminal.modes);
  return result;
}
