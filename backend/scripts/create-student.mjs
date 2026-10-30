#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { DEFAULT_STACK, createStudent, normalizeUsername, passwordFromArgs, run, usageError } from './lib.mjs';

const usage = `Usage: node scripts/create-student.mjs --username <username> [--password <password>] [--stack <name>]
  Creates a student with a permanent password (no message is sent, no password change on first login).
  The username is a pseudonym: 3-32 letters, digits, ".", "-" or "_" (case-insensitive).
  If --password is omitted you are asked for it without echo.`;

run(async () => {
  const { values } = parseArgs({
    options: {
      username: { type: 'string' },
      password: { type: 'string' },
      stack: { type: 'string', default: DEFAULT_STACK },
    },
  });
  if (!values.username) throw usageError();
  const username = normalizeUsername(values.username);
  const password = await passwordFromArgs(values);
  try {
    const sub = await createStudent({ stack: values.stack, username, password });
    console.log(`Created student ${username}`);
    console.log(`sub: ${sub}`);
  } catch (err) {
    if (err.name === 'UsernameExistsException') {
      throw new Error('A student with this username already exists. Use reset-password to change the password.');
    }
    throw err;
  }
}, usage);
