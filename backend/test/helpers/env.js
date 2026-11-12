// Must be the FIRST import of every test file: points the app at the
// dedicated test database before any module reads process.env.

import os from "node:os";
import path from "node:path";

try {
  process.loadEnvFile(new URL("../../.env", import.meta.url));
} catch {
  /* no .env: TEST_DATABASE_URL / DATABASE_URL must come from the environment */
}

const base = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!base) throw new Error("Set DATABASE_URL (or TEST_DATABASE_URL) so the test database can be derived");
const url = new URL(base);
if (!process.env.TEST_DATABASE_URL) url.pathname = "/dropputt_test";
if (!url.pathname.endsWith("_test")) {
  throw new Error(`Refusing to run tests against "${url.pathname.slice(1)}": the database name must end in _test`);
}

process.env.DATABASE_URL = url.toString();
process.env.NODE_ENV = "test";
process.env.ENABLE_CRON = "false";
process.env.JWT_SECRET = "test-secret-test-secret-test-secret-1234567890";
process.env.FIREBASE_SERVICE_ACCOUNT_PATH = "";
process.env.R2_ENDPOINT = "";
process.env.REDIS_URL = ""; // tests never use the developer's Redis
process.env.UPLOAD_DIR = path.join(os.tmpdir(), "dropputt-test-uploads");
process.env.MIN_APP_VERSION_ANDROID = "";
process.env.MIN_APP_VERSION_IOS = "";
