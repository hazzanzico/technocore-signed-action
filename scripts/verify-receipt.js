#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { verifyReceipt } from "../src/receipt.js";

const [receiptPath] = process.argv.slice(2);
if (!receiptPath) {
  console.error("usage: node scripts/verify-receipt.js <receipt.json>");
  process.exitCode = 2;
} else {
  try {
    const path = resolve(receiptPath);
    const receipt = JSON.parse(readFileSync(path, "utf8"));
    verifyReceipt(receipt);
    console.log(`valid receipt for ${receipt.did} in ${receipt.room}/${receipt.seq}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`invalid receipt: ${message}`);
    process.exitCode = 1;
  }
}
