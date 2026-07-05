# Audio File LV2 — loop section, seek & play cursor (MOD / MODEP)

This branch patches the **Audio File** plugin from
[Carla](https://github.com/falkTX/Carla)'s native plugins (`carla-files.lv2`) to add
a set of live-looping features on MOD / MODEP devices, together with an updated modgui.

Base commit: `c37d53a4216654118e711fa41e88e7e801d5bd9b`
(the commit the MOD plugin builder pins for `carla-files.lv2`).

## Features added

- **Click-to-seek** — click anywhere on the waveform to jump playback there.
- **A/B loop section** — drag a left (A) and right (B) handle on the waveform to loop a
  sub-section. Reuses the existing **Loop Mode** switch (Loop Mode on = loop the A–B
  region; default A=0 % / B=100 % = whole file, same as before). Values commit on mouse
  **release** (playback restarts once from the left handle, not on every drag pixel).
- **Play cursor** — a vertical line follows the current play position.
- **"Keep Loop On Track" setting** — a boolean control (in the plugin settings):
  - **On** — keep the A/B handles across track changes and start each new track from the
    left handle (A).
  - **Off** (default) — reset the handles to full range on track change and start from 0.
- Enabling the plugin (ON/OFF) and moving a handle both (re)start playback from the left
  handle when a loop section is set.

## DSP changes (`source/native-plugins/`)

New input control parameters (append-only, so existing pedalboards keep working):

| symbol               | LV2 port | range   | default | purpose                                   |
|----------------------|----------|---------|---------|-------------------------------------------|
| `seek`               | 16       | 0–100 % | 0       | jump playback to this position            |
| `loop_start`         | 17       | 0–100 % | 0       | loop region start (handle A)              |
| `loop_end`           | 18       | 0–100 % | 100     | loop region end (handle B)                |
| `keep_loop_on_track` | 19       | 0/1     | 0       | keep loop & start from A on track change  |

Implementation notes:
- The A/B loop wrap and the block-splitting are done in `AudioFilePlugin::process()` (the
  caller), never inside `AudioFileReader::tickFrames()` — that avoids a recursive re-lock of
  the audio-pool mutex (a deadlock in offline mode). Playback is clamped to what the memory
  pool actually holds (`min(total, numPoolFrames)` for fully-loaded files) so a chunk never
  reads past the pool. `tickFrames()` itself is unchanged from upstream behaviour.
- The loop section / seek only apply when **not** host-synced.
- `keep_loop_on_track` is a GUI-driven setting: the DSP only stores it and uses it in
  `loadFilename()` to decide the start frame; the handle reset is done by the modgui.

## modgui (`mod-audiofile/modgui/`)

MOD-specific overlay (not part of the Carla source tree):
- `javascript-audio.js`, `stylesheet-audio.css` — patched (handles, cursor, seek, setting).
- `icon-audio.html` — unchanged from the original bundle (included for completeness).
- `modguis.ttl` — unchanged (maps the modgui resources).

The binary image assets used by the modgui (`orange-knob.png`, `switch.png`,
`switch-transport.png`, `screenshot-audio.png`, `thumbnail-audio.png`) are **unchanged**
from the original `carla-files.lv2` bundle on PatchStorage — copy them from there.

`mod-audiofile/audiofile.ttl` is the reconciled LV2 manifest for the Audio File plugin
(the device's 16 original ports + the 4 new ports above). Its `lv2:minorVersion` is bumped
on every modgui change: MOD-UI caches the modgui by `builder_micro_minor_release`, so
bumping the version forces browsers to refetch the updated GUI.

## Build (aarch64 MODEP)

```sh
# from the repo root, on the target device (or a matching cross env):
sudo apt install libsndfile1-dev
bash mod-audiofile/build.sh
# -> bin/carla-files.lv2/carla.so
```

## Deploy to a MODEP device

```sh
DST=/var/modep/lv2/carla-files.lv2
sudo cp -a "$DST" ~/carla-files.lv2.backup            # backup first

sudo cp bin/carla-files.lv2/carla.so          "$DST/carla.so"
sudo cp mod-audiofile/audiofile.ttl           "$DST/audiofile.ttl"
sudo cp mod-audiofile/modgui/javascript-audio.js "$DST/modgui/"
sudo cp mod-audiofile/modgui/stylesheet-audio.css "$DST/modgui/"

# clean restart (restart the host first, never mod-ui alone — it can crash-loop):
sudo systemctl stop modep-mod-ui
sudo systemctl reset-failed modep-mod-ui modep-mod-host
sudo systemctl restart modep-mod-host
sleep 3
sudo systemctl start modep-mod-ui
```

Then hard-refresh the browser (the `minorVersion` bump busts the modgui cache) and reselect
a track (restarting the host clears the loaded sample).

## License

Same as Carla: GNU GPL v2+.
