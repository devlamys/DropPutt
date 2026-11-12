/** Structured audit log line for financial mutations (SPEC §37.10). */
export function audit(event, data = {}) {
  console.log(
    JSON.stringify({ level: "audit", event, at: new Date().toISOString(), ...data })
  );
}
