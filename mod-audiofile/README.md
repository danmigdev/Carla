# Audio File LV2 — loop section, seek, play cursor & rescan (MOD / MODEP)

This branch patches the **Audio File** plugin from
[Carla](https://github.com/falkTX/Carla)'s native plugins (`carla-files.lv2`) to add
a set of live-looping features on MOD / MODEP devices, together with an updated modgui.

Base commit: `c37d53a4216654118e711fa41e88e7e801d5bd9b`
(the commit the MOD plugin builder pins for `carla-files.lv2`).

Installation: [MODEP / Patchbox OS](#install-on-aarch64-modep--patchbox-os) or
[MOD Duo, Duo X and Dwarf](#install-on-mod-duo-duo-x-or-dwarf).

## Platforms and availability

| Platform | Build target | Validation status |
|----------|--------------|-------------------|
| MODEP / Patchbox OS, Raspberry Pi aarch64 | `mod-audiofile/build.sh` | Installed; Rescan verified on a MODEP device |
| MOD Duo | `modduo` (ARM32) | Developer build instructions; hardware testing pending |
| MOD Duo X | `modduox` (aarch64) | Developer build instructions; hardware testing pending |
| MOD Dwarf | `moddwarf` (aarch64) | Developer build instructions; hardware testing pending |

This fork does not currently provide prebuilt device packages or a shareable
installation link. The MOD hardware instructions below have been checked against
the official builder source; the cross-builds have not yet been run for this fork.
MOD Desktop is not covered by these hardware instructions and has no tested package
from this fork.

## Features added

- **Rescan folder** — refresh the Loops, Recordings and Tracks lists from the device
  without reloading the browser, pedalboard or plugin. Record a new take, click
  **Rescan folder**, then select it in **Recordings**. Refreshing the list preserves
  the loaded audio, playback position, A/B selection and active tab. It does not
  automatically load a new recording or reload a file overwritten at the same path.
- **Click-to-seek** — click anywhere on the waveform to jump playback to exactly that
  point (even outside the loop region), and the cursor moves there immediately, even when
  stopped. Pressing play resumes from the cursor.
- **A/B loop section** — drag a left (A) and right (B) handle on the waveform to loop a
  sub-section. Reuses the existing **Loop Mode** switch (Loop Mode on = loop the A–B
  region; default A=0 % / B=100 % = whole file, same as before). Values commit on mouse
  **release** (playback restarts once from the left handle, not on every drag pixel).
- **Play cursor** — a vertical line follows the current play position.
- **"Keep Loop On Track" setting** — a boolean control (in the plugin settings):
  - **On** — keep the A/B handles across track changes and start each new track from the
    left handle (A).
  - **Off** (default) — reset the handles to full range on track change and start from 0.
- Play head / cursor rules: **ON/OFF** resumes from the current cursor; **moving a handle**
  and a **track change** put the cursor (and playback) at the left handle (A); **clicking**
  puts it at the click. So a click-while-stopped then play starts from the click, while a
  track change starts from the left handle.

## DSP changes (`source/native-plugins/`)

New input control parameters (appended to the 16-port MODEP layout used by this fork):

| symbol               | LV2 port | range   | default | purpose                                   |
|----------------------|----------|---------|---------|-------------------------------------------|
| `seek`               | 16       | 0–100 % | 0       | jump playback to this position            |
| `loop_start`         | 17       | 0–100 % | 0       | loop region start (handle A)              |
| `loop_end`           | 18       | 0–100 % | 100     | loop region end (handle B)                |
| `keep_loop_on_track` | 19       | 0/1     | 0       | keep loop & start from A on track change  |

**Factory MOD compatibility:** the official MOD bundle has a **Play status CV**
output and a **Quad Channels** parameter that this fork omits. This fork keeps the
same Audio File plugin URI, so installing it replaces that plugin rather than adding
a separate one. Existing boards that use those factory ports need adjustment; do
not assume all factory pedalboards or control mappings are compatible. Always use
this fork's `audiofile.ttl` with its binary. See the
[official MOD metadata](https://github.com/mod-audio/mod-lv2-data/blob/3c6ebef7be59f71b57683c02c4a30f987dcb9abc/plugins-fixed/carla-files.lv2/audiofile.ttl).

`Loop Start` and `Loop End` are numeric controls, expressed as a percentage of the
file. They can be assigned to hardware controls or to CV through the host's
[CV parameter mapping](https://wiki.mod.audio/wiki/CV_Tutorial#Setting_up_Macro-Controls_using_CV).
Set **Host Sync off** to use the A/B region. Every change to either boundary restarts
playback at A, so continuous CV modulation will repeatedly retrigger playback.
Sharing percentages between instances does not guarantee time or phase sync,
especially when their files have different lengths. Physical MOD control/CV
assignments have not yet been tested with this fork.

Implementation notes:
- The A/B loop wrap and the block-splitting are done in `AudioFilePlugin::process()` (the
  caller), never inside `AudioFileReader::tickFrames()` — that avoids a recursive re-lock of
  the audio-pool mutex (a deadlock in offline mode). Playback is clamped to what the memory
  pool actually holds (`min(total, numPoolFrames)` for fully-loaded files) so a chunk never
  reads past the pool. `tickFrames()` itself is unchanged from upstream behaviour.
- When not host-synced, the internal transport is the **actual (loop-wrapped) play
  position**, written back each block — not a free-running counter folded into the region.
  So a seek lands exactly where requested; a head past the loop end plays through to the
  file end and then the loop resumes. `ON/OFF` doesn't move the head (it resumes from the
  cursor); the head is placed at the left handle by a handle move or a track load.
- The loop section / seek only apply when **not** host-synced.
- `keep_loop_on_track` is a GUI-driven setting: the DSP only stores it and uses it in
  `loadFilename()` to decide the start frame; the handle reset is done by the modgui.

## modgui (`mod-audiofile/modgui/`)

MOD-specific overlay (not part of the Carla source tree):
- `javascript-audio.js`, `stylesheet-audio.css`, `icon-audio.html` — patched (handles,
  cursor, seek, setting, rescan button).
- `modguis.ttl` — unchanged (maps the modgui resources).

The rescan button uses MOD/MODEP's existing `/files/list` endpoint and keeps the
host's file-selection widgets attached. It supports the older flat file lists and
newer folder-aware selectors without modifying MOD UI or the plugin's DSP. A failed
scan leaves the previous list available and allows retrying.

The binary image assets used by the modgui (`orange-knob.png`, `switch.png`,
`switch-transport.png`, `screenshot-audio.png`, `thumbnail-audio.png`) are **unchanged**
from the original `carla-files.lv2` bundle. The MODEP procedure preserves the installed
assets; the MOD Plugin Builder supplies them through its `lv2-data` submodule.

`mod-audiofile/audiofile.ttl` is the reconciled LV2 manifest for the Audio File plugin
(the MODEP layout's 16 original ports + the 4 new ports above). Its `lv2:minorVersion` is bumped
on every modgui change: MOD-UI caches the modgui by `builder_micro_minor_release`, so
bumping the version forces browsers to refetch the updated GUI.

## Install on aarch64 MODEP / Patchbox OS

Run these Bash commands on the Raspberry Pi, with an existing working
`/var/modep/lv2/carla-files.lv2` installation. Install the original Audio File bundle
through your MODEP plugin installer first if it is missing. The helper targets
**aarch64** (`uname -m` should report `aarch64`); 32-bit MODEP needs a different build.

```sh
sudo apt update
sudo apt install git build-essential pkg-config libsndfile1-dev
git clone --branch audio-file-loop-seek --single-branch \
  https://github.com/danmigdev/Carla.git
cd Carla
bash mod-audiofile/build.sh
# -> bin/carla-files.lv2/carla.so
```

Save your pedalboard before installation. From the same checkout, back up the
complete original bundle, then stop the services before replacing files:

```sh
set -e
DST=/var/modep/lv2/carla-files.lv2
BACKUP="$HOME/carla-files.lv2.backup-$(date -u +%Y%m%dT%H%M%SZ)"
test -f "$DST/carla.so"
test -d "$DST/modgui"
sudo cp -a "$DST" "$BACKUP"
printf 'Original bundle saved at: %s\n' "$BACKUP"

sudo systemctl stop modep-mod-ui modep-mod-host

sudo cp bin/carla-files.lv2/carla.so          "$DST/carla.so"
sudo cp mod-audiofile/audiofile.ttl           "$DST/audiofile.ttl"
sudo cp mod-audiofile/modgui/javascript-audio.js "$DST/modgui/"
sudo cp mod-audiofile/modgui/stylesheet-audio.css "$DST/modgui/"
sudo cp mod-audiofile/modgui/icon-audio.html     "$DST/modgui/"

# Start the host before the Web UI:
sudo systemctl reset-failed modep-mod-ui modep-mod-host
sudo systemctl start modep-mod-host
sleep 3
sudo systemctl start modep-mod-ui
sudo systemctl is-active modep-mod-host modep-mod-ui
```

Then hard-refresh the browser (the `minorVersion` bump busts the modgui cache) and reselect
a track (restarting the host clears the loaded sample).

### Restore the original MODEP bundle

Set `BACKUP` to the path printed during installation. These commands keep the
modified bundle separately and restore the complete original directory:

```sh
set -e
DST=/var/modep/lv2/carla-files.lv2
BACKUP="$HOME/carla-files.lv2.backup-REPLACE_WITH_YOUR_TIMESTAMP"
SAVED_MODIFIED="$HOME/carla-files.lv2.modified-$(date -u +%Y%m%dT%H%M%SZ)"
test -f "$BACKUP/carla.so"
sudo systemctl stop modep-mod-ui modep-mod-host
sudo mv "$DST" "$SAVED_MODIFIED"
sudo cp -a "$BACKUP" "$DST"
sudo systemctl reset-failed modep-mod-ui modep-mod-host
sudo systemctl start modep-mod-host
sleep 3
sudo systemctl start modep-mod-ui
```

## Install on MOD Duo, Duo X or Dwarf

Use a complete `carla-files.lv2` bundle built for your exact model. The MODEP
`carla.so` and `mod-audiofile/build.sh` use a different build environment; use the
official MOD toolchain for the three hardware targets listed above.

### Build a device bundle (developers)

Use a Linux build machine and install the prerequisites from the
[MOD Plugin Builder README](https://github.com/mod-audio/mod-plugin-builder#readme).
The following recipe was reviewed against builder commit
`dfdc3eca8296737790a1e56146ecbc496cb69e52`:

```sh
git clone --branch audio-file-loop-seek --single-branch \
  https://github.com/danmigdev/Carla.git
git clone https://github.com/mod-audio/mod-plugin-builder.git
cd mod-plugin-builder
git checkout --detach dfdc3eca8296737790a1e56146ecbc496cb69e52
git submodule update --init --recursive
```

Edit `plugins/package/carla-plugins/carla-plugins.mk`, replacing its version and
source lines with:

```make
CARLA_PLUGINS_VERSION = REPLACE_WITH_PUBLISHED_FORK_COMMIT
CARLA_PLUGINS_SITE = $(call github,danmigdev,Carla,$(CARLA_PLUGINS_VERSION))
```

Use the full 40-character commit SHA from the cloned fork (`git -C ../Carla rev-parse
HEAD`). That commit must be available on GitHub: the builder downloads it remotely
and does not include uncommitted or unpushed source edits. Use GUI/metadata files
from the same revision. The existing recipe already supplies `libsndfile` and the
device compiler flags. The package name is **`carla-plugins`**; its output bundle is
**`carla-files.lv2`**. See the
[official recipe](https://github.com/mod-audio/mod-plugin-builder/blob/dfdc3eca8296737790a1e56146ecbc496cb69e52/plugins/package/carla-plugins/carla-plugins.mk).

Before building, replace the Audio File metadata and GUI in the builder's overlay.
Keep the other resources, including the original images and MIDI File metadata:

```sh
set -e
FORK="$PWD/../Carla"
OVERLAY="$PWD/lv2-data/plugins-fixed/carla-files.lv2"
cp "$FORK/mod-audiofile/audiofile.ttl" "$OVERLAY/audiofile.ttl"
cp "$FORK/mod-audiofile/modgui/icon-audio.html" "$OVERLAY/modgui/"
cp "$FORK/mod-audiofile/modgui/javascript-audio.js" "$OVERLAY/modgui/"
cp "$FORK/mod-audiofile/modgui/stylesheet-audio.css" "$OVERLAY/modgui/"

PLATFORM=moddwarf  # use modduo or modduox for the other models
./bootstrap.sh "$PLATFORM"
./build "$PLATFORM" carla-plugins
# -> ~/mod-workdir/$PLATFORM/plugins/carla-files.lv2
```

The initial toolchain setup can take over an hour. The output path assumes the
builder's default `WORKDIR`. If rebuilding after changing the source revision or
overlay, run `./build "$PLATFORM" carla-plugins-dirclean` before the build command.
Replacing the overlay's `audiofile.ttl` is required for this fork's port layout.

### Back up and install a matching bundle

Connect your MOD device by USB. These Bash commands run on your computer;
`192.168.51.1` is the usual USB address. Change `MOD_HOST` for another connection.
Save your pedalboard and load an empty board before replacing the plugin.

For a full device backup, open **Settings → Basic → Backup & Restore**, connect a
USB stick to the device and explicitly enable **Plugins** as well as the data you
want to preserve. See the
[official backup guide](https://wiki.mod.audio/wiki/MOD_Web_GUI_User_Guide#Backup_%26_Restore).
For a separate copy of this bundle on your computer:

```sh
set -e
MOD_HOST=192.168.51.1
BACKUP="$HOME/carla-original-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP"
scp -rp "root@$MOD_HOST:/root/.lv2/carla-files.lv2" "$BACKUP/"
printf 'Original bundle saved at: %s\n' "$BACKUP"
```

Use your device's SSH credentials. If a recent SCP client requests unsupported
SFTP, add `-O` to use the legacy SCP protocol. If the installed bundle is missing
from that path, locate it or make a full Plugins backup before proceeding.

Install from the directory containing the **complete** matching `carla-files.lv2`
bundle. For the build above:

```sh
set -e
set -o pipefail
MOD_HOST=192.168.51.1
PLATFORM=moddwarf  # must match your device and the compiled bundle
cd "$HOME/mod-workdir/$PLATFORM/plugins"
tar -czf - carla-files.lv2 | base64 | \
  curl --fail --show-error -F 'package=@-' "http://$MOD_HOST/sdk/install"
```

Check that the JSON response contains **`"ok": true`**; a successful HTTP request
alone does not confirm installation. The SDK installer replaces the whole bundle,
including its MIDI File plugin, so uploading only a binary or GUI files is
insufficient. This follows the
[official deployment method](https://wiki.mod.audio/wiki/Deploy_a_plugin_to_MOD)
and [installer behavior](https://github.com/mod-audio/mod-ui/blob/master/mod/webserver.py#L77).

Hard-refresh the Web GUI, add Audio File to an empty test board, select a file and
check playback, A/B controls and **Rescan folder**. The SDK method can register the
plugin without rebooting; reboot the device if it still shows stale resources.
The MODEP service commands above apply only to MODEP.

### Restore the original MOD bundle

Load an empty board, set `BACKUP` to the directory printed by the bundle backup,
and reinstall the complete original bundle with the same SDK method:

```sh
set -e
set -o pipefail
MOD_HOST=192.168.51.1
BACKUP="$HOME/carla-original-REPLACE_WITH_YOUR_TIMESTAMP"
test -f "$BACKUP/carla-files.lv2/carla.so"
cd "$BACKUP"
tar -czf - carla-files.lv2 | base64 | \
  curl --fail --show-error -F 'package=@-' "http://$MOD_HOST/sdk/install"
```

Check for `"ok": true`, refresh the Web GUI and reload your saved board. Alternatively,
restore your full device backup through **Backup & Restore**, including **Plugins**.

### A simpler installation link for users

MOD's [online build service](http://builder.mod.audio/buildroot) accepts `.mk`
recipes and can create a persistent link with builds for Duo, Duo X and Dwarf.
Its documented workflow requires **MOD OS 1.13 or later**. A shareable link would
let users connect their device, open the link and click **Install**. See the
[official build/install guide](https://wiki.mod.audio/wiki/Build_and_deploy_%28install%29_a_plugin).

This fork does not yet include a self-contained cloud recipe or an installation
link. The local recipe changes above also depend on the patched metadata/GUI
overlay; uploading the unmodified official recipe would build the original plugin.
A cloud recipe must include that overlay, and each device build needs validation
before publishing a link or offering prebuilt bundles.

## License

Same as Carla: GNU GPL v2+.
