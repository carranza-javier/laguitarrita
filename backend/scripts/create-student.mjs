#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { DEFAULT_STACK, createStudent, normalizeEmail, passwordFromArgs, run, usageError } from './lib.mjs';

const usage = `Usage: node scripts/create-student.mjs --email <email> --name "<full name>" [--password <password>] [--stack <name>]
  Creates a student with a permanent password (no e-mail is sent, no password change on first login).
  If --password is omitted you are asked for it without echo.`;

run(async () => {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      password: { type: 'string' },
      stack: { type: 'string', default: DEFAULT_STACK },
    },
  });
  if (!values.email || !values.name) throw usageError();
  const password = await passwordFromArgs(values);
  try {
    const sub = await createStudent({ ...values, password });
    console.log(`Created student ${values.name} <${normalizeEmail(values.email)}>`);
    console.log(`sub: ${sub}`);
  } catch (err) {
    if (err.name === 'UsernameExistsException') {
      throw new Error('A student with this e-mail already exists. Use reset-password to change the password.');
    }
    throw err;
  }
}, usage);
