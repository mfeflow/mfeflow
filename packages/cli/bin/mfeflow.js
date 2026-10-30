#!/usr/bin/env node
import { main } from '../dist/index.js';

process.exitCode = main(process.argv.slice(2), (text) => {
  process.stdout.write(`${text}\n`);
});
