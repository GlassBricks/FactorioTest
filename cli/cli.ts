#!/usr/bin/env node
import { main } from "./main.js"

process.exit(await main(process.argv))
