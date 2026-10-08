#!/bin/bash
# Build the Audio File Plus LV2 bundle natively, e.g. on MODEP / Patchbox OS (Raspberry Pi aarch64).
#
# Run from the ROOT of this Carla checkout. The bundle is always built as the MOD variant of
# the plugin (the Makefile target defines __MOD_DEVICES__), so no source or flag edits are needed.
#
# Output: bin/audiofile-plus.lv2/ (binary + ttl + modgui), ready to copy to the LV2 folder.
#
# Requires: gcc/g++, make, libsndfile-dev.
set -e

COMMON=(HAVE_DGL=false HAVE_FFMPEG=false HAVE_FLUIDSYNTH=false HAVE_HYLIA=false \
        HAVE_LIBLO=false HAVE_PYQT=false HAVE_YSFX=false HAVE_X11=false \
        USING_JUCE=false NOOPT=true)

make -j"$(nproc)" "${COMMON[@]}" audiofile-plus

echo
echo "Built: bin/audiofile-plus.lv2"
echo "Install it next to the stock plugins (see audiofile-plus/README.md)."
