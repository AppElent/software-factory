#!/usr/bin/env node
import { baselineMain } from './lib/baseline.mjs';
baselineMain('general').catch(error => { console.error(error.message); process.exitCode = 1; });
