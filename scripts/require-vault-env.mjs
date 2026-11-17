/**
 * Fail-fast before Pulumi CLI if vault-backed env vars are missing.
 * Prints the variable name; exit ≠ 0. Used by up/destroy wrappers.
 */
const required = ["APP_DB_PASSWORD", "PULUMI_CONFIG_PASSPHRASE"];

for (const name of required) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    console.error(`missing required env ${name}`);
    process.exit(1);
  }
}
