function (event, funcs)
{
    /* constants */
    var svg_width = 432;
    var svg_height = 80;

    function draw_audio(svg, values, uniqueId) {
        svg.clear();

        var svgdata = [];
        var val;
        for (var x = 0; x < values.length; ++x) {
            val = (1.0 - values[x]) * svg_height;
            svgdata.push([x*4, svg_height])
            svgdata.push([x*4, val])
            svgdata.push([x*4+3, val])
            svgdata.push([x*4+3, svg_height])
        }

        var defs = svg.defs(uniqueId);
        svg.linearGradient(defs, 'fillBg-'+uniqueId, [
            [0, '#d67516'],
            [0, '#d67516'],
            [0, 'white'],
            [1, 'white']
        ]);

        var g = svg.group({fill: 'url(#fillBg-'+uniqueId+')'});
        svg.polyline(g, svgdata);
    }

    function update_audio_position(svg, position, uniqueId) {
        // this align to a 4px grid
        var offset = Math.round((position*svg_width/100)/4)*4/svg_width;
        $(svg.getElementById(uniqueId)).find('stop:nth-child(2n+1)').attr('offset', offset.toString());
    }

    function prepare_loading_status_change(eventdata, icon, funcs) {
        if (eventdata.loadingTimeoutHandle !== null) {
            clearTimeout(eventdata.loadingTimeoutHandle)
        }
        eventdata.loadingTimeoutHandle = setTimeout(function() {
            var text, values = eventdata.values;
            if (values['num_channels'] == 0) {
                text = "No file loaded";
            } else {
                text = sprintf("%s %d-Bit, %fkHz, %dm%ds",
                               values['num_channels'] == 2 ? "Stereo" : "Mono",
                               values['bit_depth'],
                               values['sample_rate'] / 1000,
                               Math.floor(values['length'] / 60), Math.round(values['length'] % 60));
                // if we reach this point but still do not have preview data, ask for it
                if (! eventdata.hasPreview) {
                    eventdata.hasPreview = true;
                    funcs.patch_get("http://kxstudio.sf.net/carla/preview")
                }
            }
            icon.find('.file-info-details').text(text)
        }, 50)
    }

    if (event.type == 'start')
    {
        var svgElem = event.icon.find('.file-info-svg');
        var values = event.data.values = {
            'loop_mode': 1,
            'num_channels': 0,
            'bit_rate': 0,
            'bit_depth': 0,
            'sample_rate': 0,
            'length': 0,
        };
        event.data.lastPosition = null;
        event.data.loadingTimeoutHandle = null;
        event.data.uniqueId = svgElem.uniqueId().attr('id');
        event.icon.find('.falktx-audio-file-mode-option').click(function() {
            var self = $(this);
            var filetype = self.attr('filetype');

            event.icon.find('.falktx-audio-file-mode-option').removeClass('selected');
            self.addClass('selected')

            event.icon.find('.mod-enumerated-list').children().each(function(index, elem) {
                var jselem = $(elem);
                if (jselem.attr('mod-filetype') === filetype) {
                    jselem.show()
                } else {
                    jselem.hide()
                }
            })
        });
        setTimeout(function() {
            event.icon.find('.falktx-audio-file-mode-option:first-child').click();
        }, 1);
        // setup svg
        var svg = svgElem.svg().svg('get');
        svg.configure({width: '' + svg_width + 'px'}, false);
        svg.configure({height: '' + svg_height + 'px'}, false);
        // click-to-seek: clicking on the waveform jumps playback to that position
        svgElem.css('cursor', 'pointer');
        svgElem.on('click', function (e) {
            var rect = this.getBoundingClientRect();
            if (rect.width <= 0) {
                return;
            }
            var pos = (e.clientX - rect.left) / rect.width * 100.0;
            if (pos < 0.0) {
                pos = 0.0;
            } else if (pos > 100.0) {
                pos = 100.0;
            }
            funcs.set_port_value('seek', pos);
        });
        // --- loop-section handles (A/B) drawn over the waveform ---
        var infoBox = event.icon.find('.falktx-audio-file-info');
        var loopRegion = $('<div class="loop-region"></div>');
        var loopHandleA = $('<div class="loop-handle loop-handle-a"></div>');
        var loopHandleB = $('<div class="loop-handle loop-handle-b"></div>');
        var playCursor = $('<div class="play-cursor"></div>');
        infoBox.append(loopRegion).append(playCursor).append(loopHandleA).append(loopHandleB);
        event.data.loopStart = 0.0;
        event.data.loopEnd = 100.0;

        var layoutCursor = function (pos) {
            if (pos < 0.0) { pos = 0.0; } else if (pos > 100.0) { pos = 100.0; }
            playCursor.css('left', (pos / 100.0 * svg_width) + 'px');
        };
        event.data.layoutCursor = layoutCursor;
        layoutCursor(0.0);

        var layoutLoop = function () {
            var ax = event.data.loopStart / 100.0 * svg_width;
            var bx = event.data.loopEnd / 100.0 * svg_width;
            loopHandleA.css('left', ax + 'px');
            loopHandleB.css('left', bx + 'px');
            loopRegion.css({ left: ax + 'px', width: Math.max(0, bx - ax) + 'px' });
        };
        event.data.layoutLoop = layoutLoop;
        layoutLoop();

        var startLoopDrag = function (which) {
            return function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                var moveEvt = 'mousemove.audiofileloop touchmove.audiofileloop';
                var upEvt = 'mouseup.audiofileloop touchend.audiofileloop';
                var onMove = function (mv) {
                    var rect = svgElem[0].getBoundingClientRect();
                    if (rect.width <= 0) {
                        return;
                    }
                    var cx = mv.clientX;
                    if (cx == null && mv.originalEvent && mv.originalEvent.touches && mv.originalEvent.touches.length) {
                        cx = mv.originalEvent.touches[0].clientX;
                    }
                    var pct = (cx - rect.left) / rect.width * 100.0;
                    if (pct < 0.0) {
                        pct = 0.0;
                    } else if (pct > 100.0) {
                        pct = 100.0;
                    }
                    if (which === 'a') {
                        if (pct > event.data.loopEnd - 1.0) {
                            pct = event.data.loopEnd - 1.0;
                        }
                        if (pct < 0.0) {
                            pct = 0.0;
                        }
                        event.data.loopStart = pct;
                    } else {
                        if (pct < event.data.loopStart + 1.0) {
                            pct = event.data.loopStart + 1.0;
                        }
                        if (pct > 100.0) {
                            pct = 100.0;
                        }
                        event.data.loopEnd = pct;
                    }
                    layoutLoop(); // visual only while dragging
                };
                var onUp = function () {
                    $(document).off(moveEvt, onMove).off(upEvt, onUp);
                    // commit only on mouse release: this updates the DSP loop region and
                    // (in the DSP) restarts playback from the left handle -- once, not per move
                    if (which === 'a') {
                        funcs.set_port_value('loop_start', event.data.loopStart);
                    } else {
                        funcs.set_port_value('loop_end', event.data.loopEnd);
                    }
                };
                $(document).on(moveEvt, onMove).on(upEvt, onUp);
            };
        };
        loopHandleA.on('mousedown touchstart', startLoopDrag('a'));
        loopHandleB.on('mousedown touchstart', startLoopDrag('b'));

        // "keep loop on track change" is a plugin setting (keep_loop_on_track control port,
        // shown in the pedal settings, NOT on the waveform). Value tracked via the 'change'
        // handler below. ON = keep handles + DSP starts the new track at the left handle;
        // OFF = the modgui resets the handles to full range on track change (see preview event).
        event.data.keepLoopOnTrack = false;
    }
    else if (event.type == 'change')
    {
        switch (event.symbol)
        {
        case 'loop_mode':
            event.data.values[event.symbol] = event.value;
            event.data.lastPosition = null;
            return;
        case 'loop_start':
            event.data.loopStart = event.value;
            if (event.data.layoutLoop) {
                event.data.layoutLoop();
            }
            return;
        case 'loop_end':
            event.data.loopEnd = event.value;
            if (event.data.layoutLoop) {
                event.data.layoutLoop();
            }
            return;
        case 'keep_loop_on_track':
            event.data.keepLoopOnTrack = event.value > 0.5;
            return;
        case 'num_channels':
        case 'bit_rate':
        case 'bit_depth':
        case 'sample_rate':
        case 'length':
            event.data.values[event.symbol] = event.value;
            prepare_loading_status_change(event.data, event.icon, funcs);
            return;
        case 'position':
            if (event.data.lastPosition !== event.value) {
                event.data.lastPosition = event.value;
                update_audio_position(event.icon.find('.file-info-svg').svg('get'),
                                      event.value, event.data.uniqueId);
                if (event.data.layoutCursor) {
                    event.data.layoutCursor(event.value);
                }
            }
            return;
        }
        if (event.uri) {
            event.data.lastPosition = null;
        }
        if (event.uri === "http://kxstudio.sf.net/carla/preview") {
            event.data.hasPreview = true;
            draw_audio(event.icon.find('.file-info-svg').svg('get'),
                       event.value, event.data.uniqueId);
            // a new waveform means a track was (re)loaded. On an actual track CHANGE (not the
            // first load / pedalboard restore), if "keep loop on track" is OFF, reset the loop
            // handles to full range (the DSP starts the new track from 0). If ON, keep the
            // handles as they are (the DSP starts the new track from the left handle).
            if (event.data.trackLoadedOnce) {
                if (! event.data.keepLoopOnTrack) {
                    event.data.loopStart = 0.0;
                    event.data.loopEnd = 100.0;
                    if (event.data.layoutLoop) {
                        event.data.layoutLoop();
                    }
                    funcs.set_port_value('loop_start', 0.0);
                    funcs.set_port_value('loop_end', 100.0);
                }
            } else {
                event.data.trackLoadedOnce = true;
            }
            return;
        }
    }
}
