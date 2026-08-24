import { runAction } from "./action.js";

function escapeWorkflowCommand(value) {
  return String(value).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}
try {
  const outputs = await runAction();
  console.log(`Signed Technocore record ${outputs.room}/${outputs.seq} as ${outputs.did}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`::error::${escapeWorkflowCommand(message)}`);
  process.exitCode = 1;
}
