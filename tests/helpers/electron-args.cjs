// Plain _electron.launch already gets these switches from Playwright's loader.
// Explicit executablePath launches bypass that loader and must opt in here.
function testElectronArgs(args) {
  if (process.platform === "darwin") return ["--use-mock-keychain", ...args];
  if (process.platform === "linux" && process.env.CI) return ["--password-store=basic", ...args];
  return [...args];
}
module.exports = { testElectronArgs };
