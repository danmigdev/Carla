#!/bin/bash
# Build the carla-files.lv2 bundle (Audio File + MIDI File) for a MOD / MODEP device.
#
# Run from the ROOT of this Carla checkout. This branch already contains the patched
# source/native-plugins/audio-file.cpp and audio-base.hpp (seek + A/B loop section +
# play cursor + "keep loop on track" setting).
#
# Reference target: MODEP on Patchbox OS, Raspberry Pi aarch64 (Debian bookworm).
# For a different architecture, change -D_MOD_DEVICE_GENERIC_AARCH64 and -march accordingly.
#
# Output: bin/carla-files.lv2/carla.so
#
# Requires: gcc/g++, make, libsndfile-dev.
set -e

# __MOD_DEVICES__ selects the MOD build of the plugin (correct port layout, no CV port).
# Command-line CXXFLAGS get lost in the recursive sub-make, so append the defines directly
# to BASE_FLAGS in source/Makefile.mk (idempotent).
MK=source/Makefile.mk
grep -q "__MOD_DEVICES__" "$MK" || sed -i \
  's#^BASE_FLAGS = -Wall -Wextra -pipe -DBUILDING_CARLA -MD -MP -fno-common#&\nBASE_FLAGS += -D__MOD_DEVICES__ -D_MOD_DEVICE_GENERIC_AARCH64#' "$MK"

COMMON=(HAVE_DGL=false HAVE_FFMPEG=false HAVE_FLUIDSYNTH=false HAVE_HYLIA=false \
        HAVE_LIBLO=false HAVE_PYQT=false HAVE_YSFX=false HAVE_X11=false \
        USING_JUCE=false NOOPT=true CFLAGS=-march=armv8-a CXXFLAGS=-march=armv8-a)

make clean "${COMMON[@]}" >/dev/null 2>&1 || true
rm -rf bin/carla-files.lv2 build
make -j"$(nproc)" "${COMMON[@]}" lv2-bundles

echo
echo "Built: bin/carla-files.lv2/carla.so"
echo "Now overlay the files from mod-audiofile/ and deploy (see mod-audiofile/README.md)."
