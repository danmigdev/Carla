function (event, funcs)
{
    /* constants */
    var svg_width = 432;
    var svg_height = 80;
    var audio_file_uri = 'http://kxstudio.sf.net/carla/file/audio';
    var audio_file_types = ['audioloop', 'audiorecording', 'audiotrack'];
    var preview_uri = 'http://kxstudio.sf.net/carla/preview';

    function normalize_folder_path(current) {
        // Some host versions push full paths for every folder, while setValue
        // stores the first full path followed by relative components.
        for (var index = 1; index < current.length; ++index) {
            var parent = current.slice(0, index).join('/') + '/';
            if (current[index].indexOf(parent) === 0) {
                current[index] = current[index].slice(parent.length);
            }
        }
    }

    function filter_audio_files(icon) {
        var filetype = icon.find('.audiofile-plus-mode-option.selected').attr('filetype');
        icon.find('[mod-role="input-parameter"][mod-parameter-uri="' + audio_file_uri + '"]').each(function() {
            var control = $(this);
            var parameter = control.data('port');
            var current = control.data('currentPath');
            // Recent MOD UI also filters by folder. A different tab must not stay
            // inside a folder belonging to the previous audio category.
            if (parameter && $.isArray(current) && current.length) {
                normalize_folder_path(current);
                var path = current.join('/');
                var sameType = false;
                $.each(parameter.files, function(index, file) {
                    if (file.filetype === filetype && file.basepath &&
                        (path === file.basepath || path.indexOf(file.basepath + '/') === 0)) {
                        sameType = true;
                    }
                });
                if (!sameType) {
                    current.length = 0;
                    control.customSelectPath('refreshFileList', current);
                }
            }
            control.find('[mod-role="enumeration-option"]').each(function() {
                var option = $(this);
                option.toggle(option.attr('mod-filetype') === filetype);
            });
        });
    }

    function refresh_audio_files(event, files) {
        var selector = '[mod-role="input-parameter"][mod-parameter-uri="' + audio_file_uri + '"]';
        var controls = event.icon.find(selector);
        if (event.settings) {
            controls = controls.add(event.settings.find(selector));
        }
        // Newer hosts share parameter metadata with settings/performance widgets.
        var parameter = controls.first().data('port');
        if (parameter && parameter.widgets) {
            $.each(parameter.widgets, function(index, widget) {
                controls = controls.add(widget);
            });
        }

        var directories = [], basepaths = [];
        $.each(files, function(index, file) {
            if (!file.basepath) {
                return;
            }
            if ($.inArray(file.basepath, basepaths) < 0) {
                basepaths.push(file.basepath);
            }
            var path = file.fullname;
            var slash = path.lastIndexOf('/');
            while (slash > file.basepath.length) {
                path = path.slice(0, slash);
                var fullname = 'dir://' + path;
                var exists = false;
                $.each(directories, function(index, directory) {
                    if (directory.fullname === fullname) {
                        exists = true;
                    }
                });
                if (!exists) {
                    directories.push({
                        fullname: fullname, basename: path.slice(path.lastIndexOf('/') + 1),
                        dirname: path, filetype: 'dir', audioFileType: file.filetype,
                        basepath: file.basepath
                    });
                }
                slash = path.lastIndexOf('/');
            }
        });
        directories.sort(function(a, b) {
            return a.fullname < b.fullname ? -1 : a.fullname > b.fullname ? 1 : 0;
        });

        controls.each(function() {
            var control = $(this);
            var port = control.data('port');
            var current = control.data('currentPath');
            var folderAware = port && $.isArray(current);
            var entries = folderAware ? directories.concat(files) : files;
            var selected = port ? port.value : control.find('.selected').attr('mod-parameter-value');
            if (folderAware) {
                normalize_folder_path(current);
                // Keep the shared arrays alive for any host views rendered later.
                port.files.length = 0;
                $.each(entries, function(index, file) { port.files.push(file); });
                port.basepaths.length = 0;
                $.each(basepaths, function(index, path) { port.basepaths.push(path); });
                if (current.length && !directories.some(function(directory) {
                    return directory.fullname === 'dir://' + current.join('/');
                })) {
                    current.length = 0;
                }
            }
            // In the settings view the control IS the list, rather than its parent.
            var list = control.hasClass('mod-enumerated-list') ? control : control.find('.mod-enumerated-list');
            var scrollTop = list.scrollTop();
            list.empty();
            $.each(entries, function(index, file) {
                // File names are data: never interpolate them into HTML/selectors.
                var option = $('<div></div>').attr({
                    'mod-role': 'enumeration-option', 'mod-filetype': file.audioFileType || file.filetype,
                    'mod-parameter-value': file.fullname, 'title': file.basename
                }).text(file.basename).toggleClass('selected', file.fullname === selected);
                option.on('click.audioFileRescan', function(e) {
                    e.stopPropagation();
                    if (control.data('enabled') === false) {
                        return;
                    }
                    if (file.filetype === 'dir') {
                        if ('dir://' + current.join('/') === file.fullname) {
                            control.customSelectPath('popDir');
                        } else {
                            control.customSelectPath('pushDir', file.fullname);
                            normalize_folder_path(current);
                            control.customSelectPath('refreshFileList', current);
                        }
                    } else {
                        // Keep the existing host change handler; reinitializing the
                        // widget would accumulate handlers after repeated rescans.
                        control.controlWidget('setValue', file.fullname, false);
                    }
                    filter_audio_files(event.icon);
                });
                if (file.filetype === 'dir') {
                    $('<span aria-hidden="true"></span>').text('↳ ').prependTo(option);
                }
                list.append(option);
            });
            if (folderAware) {
                control.customSelectPath('refreshFileList', current);
            }
            list.scrollTop(scrollTop);
        });
        filter_audio_files(event.icon);
    }

    // Waveform data from the DSP (preview property):
    // [2, file generation, view start %, view end %, scan progress, min0, max0, min1, max1, ...]
    // with one min/max pair per pixel of the visible part [view start, view end].
    function clamp(value, min, max) {
        return value < min ? min : value > max ? max : value;
    }

    // filled min/max envelope centred on the zero line, played part in orange
    function draw_waveform(svg, minmax, uniqueId) {
        svg.clear();

        var mid = svg_height / 2;
        var top = [], bottom = [];
        for (var x = 0; x < svg_width; ++x) {
            var hi = mid - clamp(minmax[x*2+1] || 0, -1, 1) * mid;
            var lo = mid - clamp(minmax[x*2] || 0, -1, 1) * mid;
            // keep silence visible as a thin line
            if (lo - hi < 1) {
                var centre = (lo + hi) / 2;
                hi = centre - 0.5;
                lo = centre + 0.5;
            }
            top.push([x, hi], [x+1, hi]);
            bottom.push([x, lo], [x+1, lo]);
        }

        var defs = svg.defs(uniqueId);
        svg.linearGradient(defs, 'fillBg-'+uniqueId, [
            [0, '#d67516'],
            [0, '#d67516'],
            [0, 'white'],
            [1, 'white']
        ]);

        var g = svg.group({fill: 'url(#fillBg-'+uniqueId+')'});
        svg.polygon(g, top.concat(bottom.reverse()));
    }

    // min/max pairs for the pixels of [start, end] taken from an already received waveform,
    // to redraw at once while zooming; the exact data from the DSP replaces it when it arrives
    function resample_waveform(wave, start, end) {
        var minmax = new Array(svg_width * 2);
        var span = wave.end - wave.start;
        for (var x = 0; x < svg_width; ++x) {
            var p0 = start + (end - start) * x / svg_width;
            var p1 = start + (end - start) * (x + 1) / svg_width;
            var i0 = Math.floor((p0 - wave.start) / span * svg_width);
            var i1 = Math.ceil((p1 - wave.start) / span * svg_width);
            var lo = 0, hi = 0, found = false;
            for (var i = Math.max(i0, 0); i < Math.min(Math.max(i1, i0 + 1), svg_width); ++i) {
                if (!found || wave.minmax[i*2] < lo) { lo = wave.minmax[i*2]; }
                if (!found || wave.minmax[i*2+1] > hi) { hi = wave.minmax[i*2+1]; }
                found = true;
            }
            minmax[x*2] = lo;
            minmax[x*2+1] = hi;
        }
        return minmax;
    }

    function update_audio_position(svg, data, position, uniqueId) {
        var offset = clamp((position - data.viewStart) / (data.viewEnd - data.viewStart), 0, 1);
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
                    funcs.patch_get(preview_uri)
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
        event.icon.find('.audiofile-plus-mode-option').click(function() {
            var self = $(this);

            event.icon.find('.audiofile-plus-mode-option').removeClass('selected');
            self.addClass('selected')
            filter_audio_files(event.icon);
        });
        event.data.rescanPending = false;
        event.icon.find('.audio-file-rescan').on('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            if (event.data.rescanPending) {
                return;
            }
            event.data.rescanPending = true;
            var button = $(this);
            var status = event.icon.find('.audio-file-rescan-status');
            button.prop('disabled', true);
            status.text('Scanning…');
            $.ajax({
                url: '/files/list',
                data: { types: audio_file_types.join(',') },
                dataType: 'json', cache: false, timeout: 15000,
                success: function(data) {
                    var valid = data && data.ok !== false && $.isArray(data.files);
                    if (valid) {
                        $.each(data.files, function(index, file) {
                            if (!file || typeof file.fullname !== 'string' || typeof file.basename !== 'string' ||
                                $.inArray(file.filetype, audio_file_types) < 0) {
                                valid = false;
                            }
                        });
                    }
                    if (!valid) {
                        status.text('Could not rescan. Try again.');
                        return;
                    }
                    refresh_audio_files(event, data.files);
                    status.text('File list updated.');
                },
                error: function() {
                    status.text('Could not rescan. Try again.');
                },
                complete: function() {
                    event.data.rescanPending = false;
                    button.prop('disabled', false);
                }
            });
        });
        setTimeout(function() {
            event.icon.find('.audiofile-plus-mode-option:first-child').click();
        }, 1);
        // setup svg
        var svg = svgElem.svg().svg('get');
        svg.configure({width: '' + svg_width + 'px'}, false);
        svg.configure({height: '' + svg_height + 'px'}, false);
        // --- visible part of the file (zoom), in % of the file ---
        var data = event.data;
        data.viewStart = 0.0;
        data.viewEnd = 100.0;
        data.viewTimer = null;
        data.generation = null;
        data.fullWave = null;
        data.lastWave = null;

        // position in % of the file at a fraction (0..1) of the waveform width, and back
        var frac_to_pos = function (frac) {
            return data.viewStart + frac * (data.viewEnd - data.viewStart);
        };
        var pos_to_x = function (pos) {
            return (pos - data.viewStart) / (data.viewEnd - data.viewStart) * svg_width;
        };
        // fraction of the waveform width under the mouse (also right with the pedalboard zoomed)
        var client_frac = function (clientX) {
            var rect = svgElem[0].getBoundingClientRect();
            return rect.width > 0 ? clamp((clientX - rect.left) / rect.width, 0, 1) : null;
        };

        // smallest view: one sample per pixel
        var min_view_span = function () {
            var frames = data.values['length'] * data.values['sample_rate'];
            return frames > svg_width ? svg_width / frames * 100.0 : 100.0;
        };

        // draw the view now from the best waveform already received.
        // The view a waveform was made for comes back rounded (32-bit float, 6 decimals in the host
        // messages), so it is compared with a tolerance of about 2 pixels.
        var redraw_view = function () {
            var tolerance = Math.max((data.viewEnd - data.viewStart) / svg_width * 2, 2e-5);
            var wave = data.lastWave;
            if (!wave || wave.start > data.viewStart + tolerance || wave.end < data.viewEnd - tolerance) {
                wave = data.fullWave;
            }
            if (wave) {
                var exact = Math.abs(wave.start - data.viewStart) <= tolerance &&
                            Math.abs(wave.end - data.viewEnd) <= tolerance;
                draw_waveform(svg, exact ? wave.minmax : resample_waveform(wave, data.viewStart, data.viewEnd),
                              data.uniqueId);
                update_audio_position(svg, data, data.cursorPos, data.uniqueId);
            }
            data.layoutLoop();
            data.layoutCursor(data.cursorPos);
        };
        data.redrawView = redraw_view;

        // ask the DSP for the exact waveform of the view, at most every 40 ms while scrolling
        var send_view = function (now) {
            if (data.viewTimer !== null) {
                if (!now) {
                    return;
                }
                clearTimeout(data.viewTimer);
            }
            var send = function () {
                data.viewTimer = null;
                funcs.set_port_value('view_start', data.viewStart);
                funcs.set_port_value('view_end', data.viewEnd);
            };
            if (now) {
                send();
            } else {
                data.viewTimer = setTimeout(send, 40);
            }
        };
        data.sendView = send_view;

        var set_view = function (start, span) {
            span = clamp(span, Math.min(min_view_span(), 100.0), 100.0);
            start = clamp(start, 0.0, 100.0 - span);
            if (start === data.viewStart && start + span === data.viewEnd) {
                return;
            }
            data.viewStart = start;
            data.viewEnd = start + span;
            redraw_view();
            send_view(false);
        };

        // zoomed in: when the cursor leaves the view while playing (end of the page, loop back to A,
        // seek elsewhere), show the page that starts at the cursor. A cursor already outside the view
        // (scrolled away on purpose) is left alone.
        data.followPlayhead = function (previous, pos) {
            var span = data.viewEnd - data.viewStart;
            if (span >= 100.0 || previous === null) {
                return;
            }
            var wasVisible = previous >= data.viewStart && previous <= data.viewEnd;
            var visible = pos >= data.viewStart && pos <= data.viewEnd;
            if (wasVisible && !visible) {
                set_view(pos, span);
            }
        };

        // mouse wheel: zoom around the pointer; Shift + wheel or sideways scrolling: move along the file
        svgElem.parent().on('wheel mousewheel DOMMouseScroll', function (e) {
            // never let mod-ui zoom the pedalboard while over the waveform
            e.preventDefault();
            e.stopPropagation();
            var oe = e.originalEvent;
            if (e.type !== 'wheel' || !oe || data.values['length'] <= 0) {
                return;
            }
            var unit = oe.deltaMode === 1 ? 16 : oe.deltaMode === 2 ? svg_width : 1;
            var dx = oe.deltaX * unit, dy = oe.deltaY * unit;
            var span = data.viewEnd - data.viewStart;
            if (oe.shiftKey || Math.abs(dx) > Math.abs(dy)) {
                var delta = dx !== 0 ? dx : dy;
                set_view(data.viewStart + delta / svg_width * span, span);
            } else {
                var frac = client_frac(oe.clientX);
                if (frac === null) {
                    return;
                }
                var anchor = frac_to_pos(frac);
                var newSpan = clamp(span * Math.pow(1.002, dy), Math.min(min_view_span(), 100.0), 100.0);
                set_view(anchor - frac * newSpan, newSpan);
            }
        });

        // when zoomed in, dragging the waveform moves the view; a click without moving still seeks
        var event_client_x = function (ev) {
            var oe = ev.originalEvent;
            if (oe && oe.touches && oe.touches.length) {
                return oe.touches[0].clientX;
            }
            if (oe && oe.changedTouches && oe.changedTouches.length) {
                return oe.changedTouches[0].clientX;
            }
            return ev.clientX;
        };
        data.panned = false;
        svgElem.on('mousedown touchstart', function (e) {
            if (e.type === 'mousedown' && e.which !== 1) {
                return;
            }
            e.stopPropagation();
            data.panned = false;
            var span = data.viewEnd - data.viewStart;
            if (span >= 100.0) {
                return;
            }
            var startX = event_client_x(e);
            var startView = data.viewStart;
            var moveEvt = 'mousemove.audiofilepan touchmove.audiofilepan';
            var upEvt = 'mouseup.audiofilepan touchend.audiofilepan';
            var onMove = function (mv) {
                var rect = svgElem[0].getBoundingClientRect();
                var dx = event_client_x(mv) - startX;
                if (!data.panned && Math.abs(dx) < 4) {
                    return;
                }
                if (!data.panned) {
                    data.panned = true;
                    svgElem.css('cursor', 'grabbing');
                }
                mv.preventDefault();
                if (rect.width > 0) {
                    set_view(startView - dx / rect.width * span, span);
                }
            };
            var onUp = function () {
                $(document).off(moveEvt, onMove).off(upEvt, onUp);
                svgElem.css('cursor', 'pointer');
            };
            $(document).on(moveEvt, onMove).on(upEvt, onUp);
        });

        // click-to-seek: clicking on the waveform jumps playback to that position
        svgElem.css('cursor', 'pointer');
        svgElem.on('click', function (e) {
            // the end of a drag that moved the view is not a click
            if (data.panned) {
                data.panned = false;
                return;
            }
            var frac = client_frac(e.clientX);
            if (frac === null) {
                return;
            }
            var pos = clamp(frac_to_pos(frac), 0.0, 100.0);
            funcs.set_port_value('seek', pos);
            // move the play cursor to exactly where the user clicked, immediately -- so it
            // responds even when stopped, and lands on the click even outside the loop range
            event.data.lastPosition = pos;
            if (event.data.layoutCursor) {
                event.data.layoutCursor(pos);
            }
        });
        // --- loop-section handles (A/B) drawn over the waveform ---
        var infoBox = event.icon.find('.audiofile-plus-info');
        var loopRegion = $('<div class="loop-region"></div>');
        var loopHandleA = $('<div class="loop-handle loop-handle-a"></div>');
        var loopHandleB = $('<div class="loop-handle loop-handle-b"></div>');
        var playCursor = $('<div class="play-cursor"></div>');
        infoBox.append(loopRegion).append(playCursor).append(loopHandleA).append(loopHandleB);
        event.data.loopStart = 0.0;
        event.data.loopEnd = 100.0;

        // cursor and handles follow the view and are hidden when outside it
        var layoutCursor = function (pos) {
            data.cursorPos = pos;
            var x = pos_to_x(clamp(pos, 0.0, 100.0));
            playCursor.css('left', x + 'px').toggle(x >= 0 && x <= svg_width);
        };
        event.data.layoutCursor = layoutCursor;
        layoutCursor(0.0);

        var layoutLoop = function () {
            var ax = pos_to_x(event.data.loopStart);
            var bx = pos_to_x(event.data.loopEnd);
            loopHandleA.css('left', ax + 'px').toggle(ax >= 0 && ax <= svg_width);
            loopHandleB.css('left', bx + 'px').toggle(bx >= 0 && bx <= svg_width);
            var rx0 = clamp(ax, 0, svg_width), rx1 = clamp(bx, 0, svg_width);
            loopRegion.css({ left: rx0 + 'px', width: Math.max(0, rx1 - rx0) + 'px' });
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
                    var cx = mv.clientX;
                    if (cx == null && mv.originalEvent && mv.originalEvent.touches && mv.originalEvent.touches.length) {
                        cx = mv.originalEvent.touches[0].clientX;
                    }
                    var frac = client_frac(cx);
                    if (frac === null) {
                        return;
                    }
                    var pct = frac_to_pos(frac);
                    // keep A and B a few pixels apart, and at least the 10 ms the DSP needs to loop
                    var length = event.data.values['length'];
                    var gap = Math.max((data.viewEnd - data.viewStart) * 0.01, length > 0 ? 1.0 / length : 1.0);
                    if (which === 'a') {
                        if (pct > event.data.loopEnd - gap) {
                            pct = event.data.loopEnd - gap;
                        }
                        if (pct < 0.0) {
                            pct = 0.0;
                        }
                        event.data.loopStart = pct;
                    } else {
                        if (pct < event.data.loopStart + gap) {
                            pct = event.data.loopStart + gap;
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
                var previous = event.data.lastPosition;
                event.data.lastPosition = event.value;
                if (event.data.followPlayhead) {
                    event.data.followPlayhead(previous, event.value);
                }
                update_audio_position(event.icon.find('.file-info-svg').svg('get'),
                                      event.data, event.value, event.data.uniqueId);
                if (event.data.layoutCursor) {
                    event.data.layoutCursor(event.value);
                }
            }
            return;
        case 'view_start':
        case 'view_end':
            // restored with the pedalboard; the waveform for it follows from the DSP
            if (event.symbol === 'view_start') {
                event.data.viewStart = event.value;
            } else {
                event.data.viewEnd = event.value;
            }
            if (event.data.redrawView && event.data.viewEnd > event.data.viewStart) {
                event.data.redrawView();
            }
            return;
        }
        if (event.uri === audio_file_uri) {
            filter_audio_files(event.icon);
        }
        if (event.uri && event.uri !== preview_uri) {
            event.data.lastPosition = null;
        }
        if (event.uri === preview_uri) {
            var v = event.value;
            // older formats (stock Audio File) are not drawn
            if (!v || v.length < 5 + svg_width * 2 || v[0] !== 2) {
                return;
            }
            event.data.hasPreview = true;
            var wave = { start: v[2], end: v[3], minmax: v.slice(5) };
            var newTrack = v[1] !== event.data.generation;
            var firstLoad = event.data.generation === null;
            event.data.generation = v[1];

            if (newTrack) {
                event.data.fullWave = null;
                event.data.lastWave = null;
                // a new file starts with the whole file in view; on the first waveform (pedalboard
                // load, page refresh) keep the zoom saved with the pedalboard
                if (!firstLoad && (event.data.viewStart !== 0.0 || event.data.viewEnd !== 100.0)) {
                    event.data.viewStart = 0.0;
                    event.data.viewEnd = 100.0;
                    event.data.sendView(true);
                }
            }
            if (wave.start <= 0.0001 && wave.end >= 99.9999) {
                event.data.fullWave = wave;
            }
            event.data.lastWave = wave;
            event.data.redrawView();

            if (!newTrack) {
                return;
            }
            // On an actual track CHANGE (not the first load / pedalboard restore), if
            // "keep loop on track" is OFF, reset the loop handles to full range (the DSP starts
            // the new track from 0). If ON, keep the handles as they are (the DSP starts the new
            // track from the left handle).
            if (!firstLoad) {
                if (! event.data.keepLoopOnTrack) {
                    event.data.loopStart = 0.0;
                    event.data.loopEnd = 100.0;
                    if (event.data.layoutLoop) {
                        event.data.layoutLoop();
                    }
                    funcs.set_port_value('loop_start', 0.0);
                    funcs.set_port_value('loop_end', 100.0);
                }
                // on a track change the DSP starts the new track at the left handle, so move
                // the play cursor there too (works whether stopped or playing)
                event.data.lastPosition = event.data.loopStart;
                if (event.data.layoutCursor) {
                    event.data.layoutCursor(event.data.loopStart);
                }
            }
            return;
        }
    }
}
