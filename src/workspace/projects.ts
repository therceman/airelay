import fs from 'node:fs';
import { provisionWorkspace, selectorParts, selectorPath } from './provision';

export function sourceDirectory(directory: string): string {
  const source = fs.realpathSync(directory);
  if (!fs.statSync(source).isDirectory()) throw new Error('Project source must be a directory.');
  return source;
}

export function createLauncherWorkspace(options: {
  selector: string;
  root: string;
  source: string;
  dryRun?: boolean;
}) {
  const [project, agent] = selectorParts(options.selector);
  const directory = selectorPath(options.selector, options.root);
  if (fs.existsSync(directory))
    throw new Error(
      'Workspace directory already exists; select it or use workspace provision after review.'
    );
  const source = sourceDirectory(options.source);
  const plan = provisionWorkspace({
    project,
    agent,
    root: options.root,
    source,
    dryRun: options.dryRun,
  });
  return plan;
}
