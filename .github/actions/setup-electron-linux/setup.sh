#!/usr/bin/env bash
set -euo pipefail

# This script is also usable while preparing an Ubuntu 24.04 image. Set
# ELECTRON_IMAGE_BUILD=1 there: sandbox configuration belongs to the running VM.
action_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
mapfile -t packages < "$action_dir/packages.txt"
missing=()
for package in "${packages[@]}"; do
  if [[ $(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true) != 'install ok installed' ]]; then
    missing+=("$package")
  fi
done

if ((${#missing[@]})); then
  echo "Installing missing Electron packages: ${missing[*]}"
  apt_options=(-o Acquire::Retries=2 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20)
  if [[ -n ${ELECTRON_APT_ARCHIVES:-} ]]; then
    mkdir -p "$ELECTRON_APT_ARCHIVES/partial"
    apt_options+=(-o "Dir::Cache::archives=$ELECTRON_APT_ARCHIVES" -o Binary::apt-get::APT::Keep-Downloaded-Packages=true)
  fi
  update_indexes() {
    # Every required package is in Ubuntu. Avoid refreshing unrelated third-party
    # repositories (and their network failures) on each ephemeral runner.
    local source_options=()
    if [[ -f /etc/apt/sources.list.d/ubuntu.sources ]]; then
      # Blacksmith's default archive route has been slow for this repo. The
      # France Ubuntu mirror already used by the serial lane avoids that route.
      # Change it only on fallback, preserving the fast path with existing lists.
      sudo sed -i 's#http://[a-z.]*archive.ubuntu.com#http://fr.archive.ubuntu.com#g' /etc/apt/sources.list.d/ubuntu.sources
      source_options=(-o Dir::Etc::sourcelist=sources.list.d/ubuntu.sources -o Dir::Etc::sourceparts=-)
    fi
    sudo apt-get "${apt_options[@]}" "${source_options[@]}" update
  }
  # Runner images normally contain usable package indexes. Try those and cached
  # .deb files first; refresh indexes once only when installation needs it.
  if ! sudo apt-get "${apt_options[@]}" install -y --no-install-recommends "${missing[@]}"; then
    update_indexes
    sudo apt-get "${apt_options[@]}" install -y --no-install-recommends "${missing[@]}"
  fi
else
  echo 'All Electron system packages are already installed; skipping apt.'
fi

font_config=/etc/fonts/conf.d/52-ci-system-font.conf
desired_font_config=$(mktemp)
trap 'rm -f "$desired_font_config"' EXIT
cat > "$desired_font_config" <<'XML'
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <alias binding="strong"><family>Sans</family><prefer><family>Inter</family></prefer></alias>
  <alias binding="strong"><family>system-ui</family><prefer><family>Inter</family></prefer></alias>
  <alias binding="strong"><family>sans-serif</family><prefer><family>Inter</family></prefer></alias>
</fontconfig>
XML
if ! cmp -s "$desired_font_config" "$font_config"; then
  sudo install -m 0644 "$desired_font_config" "$font_config"
  fc-cache -f > /dev/null
fi
for family in 'system\-ui' Sans sans\-serif Sans:semibold Arial; do
  match=$(fc-match "$family")
  echo "$family -> $match"
  case "$family:$match" in
    Arial:*|*'"Inter"'*) ;;
    *) echo "::warning::fontconfig maps $family to $match, not Inter; text-layout tests will wrap differently" ;;
  esac
done

if [[ ${ELECTRON_IMAGE_BUILD:-0} != 1 ]]; then
  knob=/proc/sys/kernel/apparmor_restrict_unprivileged_userns
  if [[ -e $knob ]] && ! sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0; then
    echo 'ELECTRON_DISABLE_SANDBOX=1' >> "$GITHUB_ENV"
    echo '::warning::User namespaces unavailable; Electron runs with ELECTRON_DISABLE_SANDBOX=1'
  fi
fi
