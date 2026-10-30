#!/usr/bin/env node
import { main } from '../dist/index.js';

process.exitCode = main((text) => {
  process.stdout.write(`${text}\n`);
});
