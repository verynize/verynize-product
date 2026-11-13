# Electron Linux setup

Use after checkout on Ubuntu 24.04:

```yaml
- name: Set up Electron Linux dependencies
  uses: ./.github/actions/setup-electron-linux
```

The action checks the packages in `packages.txt`, installs only those missing, and caches downloaded `.deb` files by package-list revision and architecture. Existing package indexes are tried first. Only a failed install refreshes the Ubuntu indexes and retries; third-party repository indexes are excluded from that refresh. The fallback uses the France Ubuntu archive mirror already used by the serial test lane. Apt network requests have a 20-second timeout and two retries.

System font aliases retain the measured Inter metrics used by the existing CI setup. The font cache refreshes only when its configuration changes. Chromium's user-namespace setting is applied per VM, with the existing sandbox fallback if the host refuses the setting.

## Preparing an image

Blacksmith's Machine Images dashboard and current documentation label custom machine definitions as **Coming soon**. This action does not claim an image has been created or reference an unavailable runner label.

When custom images become available, the package and font portion can be baked with:

```sh
ELECTRON_IMAGE_BUILD=1 bash .github/actions/setup-electron-linux/setup.sh
```

That mode leaves host sandbox configuration to the CI job. Keep the action in each job: when all packages and font aliases are preinstalled, it skips apt and font-cache work and applies only the runtime checks.

References: [Blacksmith roadmap](https://docs.blacksmith.sh/), [runner images](https://docs.blacksmith.sh/blacksmith-runners/overview).
