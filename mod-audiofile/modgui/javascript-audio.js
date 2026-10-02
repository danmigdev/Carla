function (event, funcs)
{
    /* constants */
    var svg_width = 432;
    var svg_height = 80;
    var audio_file_uri = 'http://kxstudio.sf.net/carla/file/audio';
    var audio_file_types = ['audioloop', 'audiorecording', 'audiotrack'];

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
        var filetype = icon.find('.falktx-audio-file-mode-option.selected').attr('filetype');
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

            event.icon.find('.falktx-audio-file-mode-option').removeClass('selected');
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
            // move the play cursor to exactly where the user clicked, immediately -- so it
            // responds even when stopped, and lands on the click even outside the loop range
            event.data.lastPosition = pos;
            if (event.data.layoutCursor) {
                event.data.layoutCursor(pos);
            }
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
        if (event.uri === audio_file_uri) {
            filter_audio_files(event.icon);
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
                // on a track change the DSP starts the new track at the left handle, so move
                // the play cursor there too (works whether stopped or playing)
                event.data.lastPosition = event.data.loopStart;
                if (event.data.layoutCursor) {
                    event.data.layoutCursor(event.data.loopStart);
                }
            } else {
                event.data.trackLoadedOnce = true;
            }
            return;
        }
    }
}
