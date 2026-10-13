"use strict";
// Optional helper over an already-owned connector. No new authentication or raw input.
const { createHash, randomUUID } = require("node:crypto");
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";

async function uploadScript(execute, source, destination, options = {}) {
  if (typeof execute !== "function" || typeof source !== "string")
    throw new Error("execute callback and UTF-8 script string required");
  if (typeof destination !== "string" || !destination.startsWith("/") ||
      /[\0\r\n]/.test(destination) || destination.split("/").some(p => p === "." || p === "..") ||
      destination.endsWith("/")) throw new Error("explicit absolute remote file path required");
  const bytes = Buffer.from(source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"), "utf8");
  if (!bytes.length || bytes.length > 1048576) throw new Error("script must contain 1..1048576 UTF-8 bytes");
  const chunkBytes = options.chunk_bytes ?? 3072;
  if (!Number.isInteger(chunkBytes) || chunkBytes < 256 || chunkBytes > 3072)
    throw new Error("chunk_bytes must be 256..3072");
  const task = randomUUID(), stage = destination + ".mcp-" + task + ".partial";
  const digest = createHash("sha256").update(bytes).digest("hex");
  let ordinal = 0, lastReceipt;
  async function checked(command) {
    const result = await execute(command, {operation_id: "upload-" + task + "-" + ordinal++});
    lastReceipt = result;
    if (result.state !== "completed" || result.exit_code !== 0 || result.requires_idle_ack)
      throw new Error("upload stopped; remote staging path retained; inspect original result, never replay");
    return result;
  }
  try {
    await checked("command -v base64 >/dev/null && command -v sha256sum >/dev/null && " +
      "(umask 077; set -C; : > " + quote(stage) + ")");
    for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
      const encoded = bytes.subarray(offset, offset + chunkBytes).toString("base64");
      await checked("printf '%s' " + quote(encoded) + " | base64 -d >> " + quote(stage));
    }
    // Verify before atomic rename, then verify the final path. Upload is not execution.
    const check = "actual=$(sha256sum -- " + quote(stage) + ") && " +
      "test \"${actual%% *}\" = " + quote(digest) + " && chmod 600 -- " + quote(stage) +
      " && mv -f -- " + quote(stage) + " " + quote(destination) +
      " && sha256sum -- " + quote(destination);
    const receipt = await checked(check);
    if (receipt.capture_may_be_incomplete || receipt.truncated ||
        !receipt.text?.trim().startsWith(digest + " "))
      throw new Error("upload final verification output unavailable; inspect destination; never re-upload automatically");
    return {uploaded: true, executed: false, path: destination, sha256: digest,
      bytes: bytes.length, rpc_calls: ordinal, mode: "0600"};
  } catch (error) {
    // Even cleanup would be another terminal write. Do not send after uncertainty.
    error.staging_path = stage;
    error.destination_path = destination;
    error.last_command_id = lastReceipt?.command_id ?? null;
    error.automatic_retry = false;
    throw error;
  }
}
module.exports = {uploadScript};
