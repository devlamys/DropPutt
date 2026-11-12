/** Structured audit log line for financial mutations (SPEC §37.10). */
export function audit(event, data = {}) {
  // Keep test output readable; set AUDIT_LOG=1 to see the lines.
  if (process.env.NODE_ENV === "test" && !process.env.AUDIT_LOG) return;
  console.log(
    JSON.stringify({ level: "audit", event, at: new Date().toISOString(), ...data })
  );
}
