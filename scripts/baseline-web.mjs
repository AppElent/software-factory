#!/usr/bin/env node
import { baselineMain } from './lib/baseline.mjs';
baselineMain('web').catch(error => { console.error(error.message); process.exitCode = 1; });
