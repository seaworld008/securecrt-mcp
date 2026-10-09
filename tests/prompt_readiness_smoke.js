#!/usr/bin/env node
"use strict";
// Developer-only compiled MCP readiness checks at the Mac SDK boundary.
const { compiledNative } = require("./mac_adapter_contract");
compiledNative(process.argv[2]).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
