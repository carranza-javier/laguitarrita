#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { DEFAULT_STACK, listStudents, listVideoObjects, run } from './lib.mjs';

run(async () => {
  const { values } = parseArgs({ options: { stack: { type: 'string', default: DEFAULT_STACK } } });
  const students = await listStudents(values);
  if (!students.length) return console.log('No students yet.');
  for (const s of students) {
    const videos = await listVideoObjects({ stack: values.stack, sub: s.sub });
    console.log(`${s.username}\t${s.sub}\t${videos.length} video(s)`);
  }
}, 'Usage: node scripts/list-students.mjs [--stack <name>]');
