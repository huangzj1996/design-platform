/**
 * Removes JavaScript-style comments from JSON text. Pencil `.pen` files are
 * JSON with optional comments, so the import entry parses this cleaned text.
 * Comment characters are replaced with spaces to keep the surrounding text
 * and line structure intact; string contents are never modified.
 */
export function stripJsonComments(text: string): string {
  const input = text.startsWith('﻿') ? text.slice(1) : text;
  const output: string[] = [];
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index] ?? '';
    const next = input[index + 1];

    if (inLineComment) {
      if (character === '\n') {
        inLineComment = false;
        output.push(character);
      } else {
        output.push(' ');
      }
      continue;
    }

    if (inBlockComment) {
      if (character === '*' && next === '/') {
        inBlockComment = false;
        output.push('  ');
        index += 1;
      } else {
        output.push(character === '\n' ? '\n' : ' ');
      }
      continue;
    }

    if (inString) {
      output.push(character);
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      output.push(character);
      continue;
    }

    if (character === '/' && next === '/') {
      inLineComment = true;
      output.push('  ');
      index += 1;
      continue;
    }

    if (character === '/' && next === '*') {
      inBlockComment = true;
      output.push('  ');
      index += 1;
      continue;
    }

    output.push(character);
  }

  return output.join('');
}
