import fs from 'fs';
import path from 'path';

let _cachedVersion: string | null = null;

export function getAirelayVersion(): string {
  if (_cachedVersion === null) {
    try {
      const pkgPath = path.join(__dirname, '..', '..', 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      _cachedVersion = pkg.version || '0.0.0';
    } catch {
      _cachedVersion = '0.0.0';
    }
  }
  return _cachedVersion as string;
}

export const CONTROLLER_PROTOCOL_VERSION = 2;
