// A redirected HOME has no usable macOS login keychain. Never substitute a mock
// keychain in production: its encryption password is public.
const os = require("node:os");
const path = require("node:path");
const keychainReachable =
  process.platform !== "darwin" || path.resolve(process.env.HOME || "") === os.userInfo().homedir;
let availabilityChecks = 0;
async function isEncryptionAvailable(storage) {
  if (!keychainReachable) return false;
  availabilityChecks++;
  return (
    (await storage.isAsyncEncryptionAvailable()) &&
    storage.getSelectedStorageBackend?.() !== "basic_text"
  );
}
// Electron's async safeStorage API (the sync one is deprecated in Electron 45, removed in 46).
const seal = async (storage, text) => (await storage.encryptStringAsync(text)).toString("base64");
const unseal = async (storage, sealed) =>
  (await storage.decryptStringAsync(Buffer.from(sealed, "base64"))).result;
// Non-secret diagnostic used by the real-Electron startup regression.
const secureStorageDiagnostics = () => ({ availabilityChecks, keychainReachable });
module.exports = { isEncryptionAvailable, seal, unseal, secureStorageDiagnostics };
