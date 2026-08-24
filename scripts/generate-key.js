import { randomBytes } from "node:crypto";
import { identityFromSeed } from "../src/identity.js";

const seedBuffer = randomBytes(32);
const seed = seedBuffer.toString("hex");
seedBuffer.fill(0);
const identity = identityFromSeed(seed);

console.log("New Technocore automation identity generated locally.");
console.log(`DID: ${identity.did}`);
console.log(`Seed: ${seed}`);
console.log("Store the seed as an encrypted GitHub Actions secret, then clear this terminal.");
console.log("Anyone with the seed can sign as this DID. Never commit it or post it online.");
