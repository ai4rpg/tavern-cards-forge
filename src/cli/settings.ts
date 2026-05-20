import * as z from 'zod';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { CardrcConfig } from '../type/settings.js';

export function findCardrc(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 20; i++) {
    const candidate = resolve(dir, '.cardrc.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function loadCardrc(rootDir: string): z.infer<typeof CardrcConfig> {
  const path = resolve(rootDir, '.cardrc.json');
  if (!existsSync(path)) {
    return CardrcConfig.parse({});
  }
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  return CardrcConfig.parse(raw);
}

export interface ResolvedProject {
  cardrc: z.infer<typeof CardrcConfig>;
  rootDir: string;
  statePath: string;
  artifactPath?: string;
  projectFound: boolean;
}

export function resolveProject(
  project: string,
  opts: { state?: string; artifact?: string },
): ResolvedProject {
  const cwd = process.cwd();
  const cardrcPath = findCardrc(cwd);
  const cardrc = cardrcPath ? loadCardrc(dirname(cardrcPath)) : loadCardrc(cwd);
  const rootDir = cardrcPath ? dirname(cardrcPath) : cwd;

  const proj = cardrc.projects[project];
  if (!proj && !opts.state && !opts.artifact) {
    throw new ProjectNotFoundError(project);
  }

  const statePath = opts.state
    ? resolve(cwd, opts.state)
    : proj?.state_file
      ? resolve(rootDir, proj.state_file)
      : resolve(cwd, 'tavern-cards-state.json');

  const artifactPath = opts.artifact
    ? resolve(cwd, opts.artifact)
    : proj?.artifact
      ? resolve(rootDir, proj.artifact)
      : undefined;

  return { cardrc, rootDir, statePath, artifactPath, projectFound: Boolean(proj) };
}

export function requireConfiguredProject(project: string, found: boolean, hint?: string): void {
  if (!found) {
    throw new ProjectNotFoundError(project, hint);
  }
}

export class ProjectNotFoundError extends Error {
  constructor(project: string, hint?: string) {
    const base = `Project "${project}" not found in .cardrc.json`;
    super(hint ? `${base}. ${hint}` : `${base}.`);
    this.name = 'ProjectNotFoundError';
  }
}
