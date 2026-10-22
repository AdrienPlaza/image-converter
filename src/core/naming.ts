/**
 * Output filename templates.
 * Variables : {name} {ext} {index} {width} {height} {date}
 */
export const DEFAULT_PATTERN = '{name}_converted.{ext}';

export interface NameVariables {
  name: string;
  ext: string;
  index: number;
  width: number;
  height: number;
  date?: Date;
}

const INVALID_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

function sanitizeBase(value: string): string {
  const cleaned = value
    .replace(INVALID_CHARS, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  return (cleaned || 'image').slice(0, 100);
}

/** Builds a safe filename from the template and variables. */
export function buildFileName(pattern: string, vars: NameVariables): string {
  const date = vars.date ?? new Date();
  const isoDate = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');

  const template = pattern.trim() || DEFAULT_PATTERN;
  const name = sanitizeBase(vars.name);
  const values: Record<string, string> = {
    name,
    ext: vars.ext,
    index: String(vars.index),
    width: String(vars.width),
    height: String(vars.height),
    date: isoDate,
  };

  let result = template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
  if (!/\{ext\}/.test(template)) result += `.${vars.ext}`;

  // Sanitizes the full result (the template may contain forbidden characters).
  result = result.replace(INVALID_CHARS, '_').replace(/^\.+/, '').trim();
  return result.slice(0, 150) || `image.${vars.ext}`;
}

/** Adds a (1), (2)… suffix while the name is already used. */
export function uniqueFileName(fileName: string, used: Set<string>): string {
  if (!used.has(fileName)) {
    used.add(fileName);
    return fileName;
  }
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : '';
  let i = 2;
  let candidate = `${base} (${i})${ext}`;
  while (used.has(candidate)) {
    i++;
    candidate = `${base} (${i})${ext}`;
  }
  used.add(candidate);
  return candidate;
}

/** Removes the extension from a filename (for {name}). */
export function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}
