import { readJson } from '../util/file_io.js';
import { resolveProject } from '../cli/settings.js';
import { JSONPath } from 'jsonpath-plus';
import YAML from 'yaml';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export async function runQuery(
  project: string,
  opts: { state?: string; format?: string },
  jsonpath: string,
): Promise<void> {
  const { statePath } = resolveProject(project, opts);

  const state = readJson<JsonValue>(statePath);
  const results = JSONPath<unknown[]>({ path: jsonpath, json: state });

  if (results.length === 0) {
    process.exit(0);
  }

  const format = opts.format ?? 'json';
  if (format === 'yaml') {
    console.log(YAML.stringify(results, { lineWidth: 0 }));
  } else {
    console.log(JSON.stringify(results, null, 2));
  }
}
