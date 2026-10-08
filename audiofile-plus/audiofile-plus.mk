######################################
#
# audiofile-plus
#
######################################

# Recipe for mod-plugin-builder (plugins/package/audiofile-plus/audiofile-plus.mk), the MOD Cloud
# Builder (Buildroot section) and patchstorage-lv2-builder. The version is a pushed commit of the
# danmigdev/Carla branch audio-file-loop-seek (Audio File Plus 4.2).
AUDIOFILE_PLUS_VERSION = 3b676a6455d381d50e9b66682845594df097f505
AUDIOFILE_PLUS_SITE = $(call github,danmigdev,Carla,$(AUDIOFILE_PLUS_VERSION))
AUDIOFILE_PLUS_DEPENDENCIES = libsndfile
AUDIOFILE_PLUS_BUNDLES = audiofile-plus.lv2

AUDIOFILE_PLUS_NO_GUI = HAVE_DGL=false HAVE_FFMPEG=false HAVE_FLUIDSYNTH=false HAVE_HYLIA=false HAVE_LIBLO=false HAVE_PYQT=false HAVE_YSFX=false HAVE_X11=false USING_JUCE=false

AUDIOFILE_PLUS_TARGET_MAKE = $(TARGET_MAKE_ENV) $(TARGET_CONFIGURE_OPTS) $(MAKE) $(AUDIOFILE_PLUS_NO_GUI) NOOPT=true -C $(@D) audiofile-plus

ifeq ($(BR2_OPTIMIZE_0),y)
AUDIOFILE_PLUS_TARGET_MAKE += DEBUG=true
endif

define AUDIOFILE_PLUS_BUILD_CMDS
	$(AUDIOFILE_PLUS_TARGET_MAKE)
endef

define AUDIOFILE_PLUS_INSTALL_TARGET_CMDS
	install -d $(TARGET_DIR)/usr/lib/lv2/
	cp -rL $(@D)/bin/audiofile-plus.lv2 $(TARGET_DIR)/usr/lib/lv2/
endef

$(eval $(generic-package))
