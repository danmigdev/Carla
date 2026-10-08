# Audio File Plus (LV2, MOD / MODEP)

An audio file player for MOD and MODEP with an accurate, zoomable waveform, click-to-seek,
an A/B loop section, a play cursor and folder rescan. It is based on the **Audio File** plugin by
falkTX from [Carla](https://github.com/falkTX/Carla)'s native plugins, and it is a
separate plugin: it installs **next to** the stock Audio File and does not replace it.

| | |
|---|---|
| Name / brand | Audio File Plus / danmigdev |
| URI | `urn:danmigdev:audiofile-plus` |
| Bundle | `audiofile-plus.lv2` (binary `audiofile-plus.so`) |
| Version | `lv2:minorVersion 4`, `lv2:microVersion 2` |
| License | GNU GPL v2+, same as Carla |

Pedalboards made with the stock Audio File keep using the stock plugin. To use the new
features in an existing pedalboard, replace the stock plugin with Audio File Plus and
reselect the file.

## Platforms and testing status

| Platform | Build | Status |
|----------|-------|--------|
| MODEP / Patchbox OS, Raspberry Pi aarch64 (mod-ui 1.13) | `audiofile-plus/build.sh` on the Pi | Built and tested |
| MOD Duo (`modduo`), Duo X (`modduox`), Dwarf (`moddwarf`) | `audiofile-plus.mk` recipe | Not yet built or tested on hardware |

There are no prebuilt packages yet. Feedback from Duo, Duo X and Dwarf owners is welcome
in the [forum thread](https://forum.mod.audio/t/carla-audio-file-a-b-looping-and-waveform-seeking/13563).

## Features

Everything in MOD's stock Audio File, plus:

- **Accurate waveform**: the real minimum and maximum of the file for every pixel, centred
  on the zero line, with stereo channels combined. The plugin scans the file in the
  background, so playback starts at once and the waveform fills in (a 6-minute MP3 takes
  about 2 seconds on a Raspberry Pi 4).
- **Zoom**: the mouse wheel over the waveform zooms in and out around the pointer, down to
  single samples. To move along the file, drag the waveform (a click without moving still
  seeks), or use Shift + wheel, or scroll sideways on a trackpad. While playing, the view turns
  to the next page when the cursor reaches its right edge. Loading another file shows the
  whole file again.
- **Click-to-seek**: click anywhere on the waveform to jump there, also while stopped.
  The cursor moves immediately and pressing play resumes from it.
- **A/B loop section**: drag the left (A) and right (B) handles on the waveform to repeat a
  part of the file. It uses the existing **Loop Mode** switch: with Loop Mode on the A–B
  section loops; the default A = 0 %, B = 100 % loops the whole file. Handle positions are
  committed on mouse release, and playback restarts once from A.
- **Play cursor**: a vertical line follows the play position.
- **Keep Loop On Track** (plugin settings): on, the A/B section (as percentages) is kept
  when switching files and the new file starts from A; off (default), switching files
  resets the section to the whole file and starts from 0.
- **Rescan folder**: refreshes the Loops, Recordings and Tracks lists without reloading the
  browser, pedalboard or plugin, so a take recorded after loading the plugin can be
  selected. It keeps the loaded file, play position, A/B section and active tab. It does
  not load the new file automatically, or reload a file overwritten at the same path.

Kept from the stock plugin: Host Sync, Volume, the **Play status** CV output (0 when paused,
10 V when playing) and **Quad Channels** for 4-channel files.

Seek and the A/B section only apply with **Host Sync off**. With Host Sync on, playback
follows the host transport.

## Ports

Ports 0–17 have the same layout as MOD's stock Audio File (minorVersion 160); 18–23 are new.
`view_start` and `view_end` are the visible part of the waveform, set by the modgui while
zooming (`notOnGUI`, so they are not in the settings panel and cannot be assigned). They are
saved with the pedalboard, so zooming marks the pedalboard as modified.

| Index | Symbol | Type | Range / default |
|------:|--------|------|-----------------|
| 0, 1 | `lv2_events_in`, `lv2_events_out` | atom | file selection, waveform preview |
| 2 | `lv2_freewheel` | control in | |
| 3, 4 | `lv2_audio_out_1`, `lv2_audio_out_2` | audio out | |
| 5 | `lv2_cv_out_1` | CV out | Play status, 0 / 10 |
| 6–9 | `loop_mode`, `host_sync`, `volume`, `enabled` | control in | as stock |
| 10 | `quad_channels` | control in | 0 = 1+2, 1 = 3+4, 2 = 1&2 + 3&4 |
| 11–17 | `num_channels` … `pool_fill` | control out | file info, `position` in % |
| 18 | `seek` | control in | 0–100 %, 0 |
| 19 | `loop_start` | control in | 0–100 %, 0 |
| 20 | `loop_end` | control in | 0–100 %, 100 |
| 21 | `keep_loop_on_track` | control in | toggle, 0 |
| 22 | `view_start` | control in, hidden | 0–100 %, 0 |
| 23 | `view_end` | control in, hidden | 0–100 %, 100 |

`Loop Start`, `Loop End` and `Seek` can be assigned to hardware controls or to CV through
the host's [CV parameter mapping](https://wiki.mod.audio/wiki/CV_Tutorial#Setting_up_Macro-Controls_using_CV).
Every change to either loop boundary restarts playback at A, so continuous CV modulation
retriggers playback. Sharing percentages between instances does not give time or phase
sync when the files have different lengths.

## Build

From the root of this repository:

```sh
make HAVE_DGL=false HAVE_FFMPEG=false HAVE_FLUIDSYNTH=false HAVE_HYLIA=false \
     HAVE_LIBLO=false HAVE_PYQT=false HAVE_YSFX=false HAVE_X11=false \
     USING_JUCE=false NOOPT=true audiofile-plus
# -> bin/audiofile-plus.lv2/
```

`audiofile-plus/build.sh` runs the same command. The target always compiles the MOD variant
of the plugin (`-D__MOD_DEVICES__`), so the binary matches `audiofile-plus.ttl` on every
toolchain. Requires gcc/g++, make and libsndfile (`libsndfile1-dev` on Debian).

## Install on MODEP / Patchbox OS (aarch64)

On the Raspberry Pi (`uname -m` should print `aarch64`):

```sh
sudo apt update
sudo apt install git build-essential pkg-config libsndfile1-dev
git clone --branch audio-file-loop-seek --single-branch https://github.com/danmigdev/Carla.git
cd Carla
bash audiofile-plus/build.sh

# install through mod-ui, no service restart needed
cd bin
tar -czf - audiofile-plus.lv2 | base64 | curl --fail --show-error -F 'package=@-' http://127.0.0.1/sdk/install
```

The reply must contain `"ok": true`. The bundle lands in `/var/modep/lv2/audiofile-plus.lv2`
and the plugin appears as **Audio File Plus** by **danmigdev**; reload the browser page.

To uninstall, remove the plugin from your pedalboards, then:

```sh
sudo rm -rf /var/modep/lv2/audiofile-plus.lv2
sudo systemctl stop modep-mod-ui
sudo systemctl reset-failed modep-mod-ui modep-mod-host
sudo systemctl restart modep-mod-host
sleep 3
sudo systemctl start modep-mod-ui
```

Restart mod-host before mod-ui as above: restarting mod-ui alone can leave it in a
restart loop.

## Install on MOD Duo, Duo X or Dwarf

These builds have not been tested on hardware yet. The recipe `audiofile-plus.mk` is in
[mod-plugin-builder](https://github.com/mod-audio/mod-plugin-builder) format and builds the
commit set in `AUDIOFILE_PLUS_VERSION`: builders download that commit from GitHub and never
see local changes. For a new release, push the changes first, then update the SHA.

**MOD Cloud Builder** (needs a unit on MOD OS 1.13 or later, connected over USB):
open [builder.mod.audio](https://builder.mod.audio), Buildroot section, upload
`audiofile-plus.mk` and tick "Create shareable, persistent build". It builds for Duo, Duo X
and Dwarf and gives a link that installs the right build on any connected unit.

**Local build** with mod-plugin-builder on Linux (the first bootstrap takes about an hour):

```sh
git clone https://github.com/mod-audio/mod-plugin-builder.git
cd mod-plugin-builder
mkdir -p plugins/package/audiofile-plus
cp /path/to/Carla/audiofile-plus/audiofile-plus.mk plugins/package/audiofile-plus/
PLATFORM=moddwarf   # or modduo, modduox
./bootstrap.sh "$PLATFORM"
./build "$PLATFORM" audiofile-plus
# -> ~/mod-workdir/$PLATFORM/plugins/audiofile-plus.lv2
```

Install it on a unit connected over USB (`192.168.51.1` is the usual address):

```sh
cd ~/mod-workdir/$PLATFORM/plugins
tar -czf - audiofile-plus.lv2 | base64 | curl --fail --show-error -F 'package=@-' http://192.168.51.1/sdk/install
```

Check for `"ok": true` and refresh the web GUI. See the
[official deployment guide](https://wiki.mod.audio/wiki/Deploy_a_plugin_to_MOD).

## Patchstorage builds (MODEP)

The same recipe works with [patchstorage-lv2-builder](https://github.com/patchstorage/patchstorage-lv2-builder)
(targets `rpi-aarch64`, `patchbox-os-arm32`, `linux-amd64`); upload with
[patchstorage-lv2-uploader](https://github.com/patchstorage/patchstorage-lv2-uploader).
See the [Patchstorage LV2 guide](https://github.com/patchstorage/patchstorage-docs/wiki/Platform:-LV2-Plugins).

## Source layout

| Path | Contents |
|------|----------|
| `source/native-plugins/audio-file.cpp`, `audio-base.hpp` | DSP: seek, A/B section, keep-loop setting |
| `source/native-plugins/audio-file-peaks.hpp` | waveform scan (background thread) and views |
| `source/plugin/carla-lv2.cpp` | optional `CARLA_LV2_PLUGIN_URI` override for single-plugin bundles |
| `source/plugin/carla-lv2-bundles.cpp` | `CARLA_BUNDLE_TYPE 4`: Audio File Plus |
| `Makefile`, `source/plugin/Makefile`, `source/native-plugins/Makefile` | `audiofile-plus` target |
| `audiofile-plus/bundle/` | `manifest.ttl`, `audiofile-plus.ttl`, `modguis.ttl`, `modgui/` |
| `audiofile-plus/audiofile-plus.mk` | builder recipe |

Implementation notes:

- The plugin keeps its internal label `audiofile`, and the file and preview properties keep
  Carla's URIs (`http://kxstudio.sf.net/carla/file/audio`, `.../carla/preview`): the
  wrapper code reads and writes them. Only the plugin URI changes, so the bundle can be
  installed together with `carla-files.lv2`.
- The modgui CSS classes use the `audiofile-plus` prefix instead of the stock
  `falktx-audio-file`, because mod-ui applies every plugin's stylesheet to the whole page:
  shared class names would restyle each other when both plugins are on a pedalboard.
- The A/B wrap and block splitting are done in `AudioFilePlugin::process()`, never inside
  `AudioFileReader::tickFrames()`: that would re-lock the audio-pool mutex recursively (a
  deadlock in offline mode). Playback is clamped to what the memory pool holds
  (`min(total, numPoolFrames)` for fully-loaded files), so a chunk never reads past it.
- When not host-synced, the internal transport is the actual, loop-wrapped play position,
  written back each block. A seek lands exactly where requested; a head past the loop end
  plays through to the file end and then the loop resumes. ON/OFF does not move the head.
- `keep_loop_on_track` is driven by the modgui: the DSP only stores it and uses it in
  `loadFilename()` to choose the start frame; the handle reset is done by the modgui.
- Waveform: `AudioFilePeaks` scans the file in its own thread (own decoder handle) into
  min/max pairs per bucket of 256 frames (larger for files over about 1M buckets). The disk
  streaming done in the plugin idle is never held up. A view is 432 min/max pairs, built from
  that cache, or read straight from the file (second handle) when zoomed in past 2 buckets per
  pixel, which is sample-exact. It is sent on the `.../carla/preview` property as
  `[2, file generation, view start %, view end %, scan progress 0..1, min0, max0, ...]`
  (3540 bytes, within the wrapper's 4096-byte message buffer). The generation only changes
  when the file name changes, so the modgui can tell a track change from a waveform update
  (changing Quad Channels reloads the same file).
- The rescan button uses mod-ui's `/files/list` endpoint and supports both the older flat
  file lists and the newer folder-aware selectors.
- mod-ui caches modgui files by plugin version. Bump `lv2:minorVersion` or
  `lv2:microVersion` in `audiofile-plus.ttl` on every modgui change, or browsers keep the
  old files; even numbers show as "stable" in mod-ui.

## Credits

Audio File plugin and Carla by falkTX (GPL v2+). The modgui is based on the Audio File modgui
in MOD's [mod-lv2-data](https://github.com/mod-audio/mod-lv2-data) (`plugins-fixed/carla-files.lv2`,
commit `6f5e899c`); the knob, switch, screenshot and thumbnail images are taken from it
unchanged. That repository has no license file.
