/*
 * Carla Native Plugins - Audio File Plus waveform peaks
 * Copyright (C) 2026 danmigdev
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License as
 * published by the Free Software Foundation; either version 2 of
 * the License, or any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * For a full copy of the GNU General Public License see the GPL.txt file
 */

#ifndef AUDIO_FILE_PEAKS_HPP_INCLUDED
#define AUDIO_FILE_PEAKS_HPP_INCLUDED

#include "audio-base.hpp"
#include "CarlaThread.hpp"

#include <atomic>
#include <cmath>

// --------------------------------------------------------------------------------------------------------------------
// Min/max envelope of an audio file, for the waveform display.
// A background thread scans the whole file into a cache of min/max pairs, one per bucket of frames,
// so the disk streaming done in the plugin idle is never held up. A view of any part of the file is
// built from that cache, or read straight from the file when zoomed in beyond the cache resolution.
// Channels are merged into one envelope (the quad mode picks which channels, as for playback).

class AudioFilePeaks : private CarlaThread
{
public:
    // one min/max pair per pixel of the waveform
    static constexpr uint32_t kViewPoints = 432;

    typedef void (*NotifyFunc)(void* ptr);

    AudioFilePeaks()
        : CarlaThread("AudioFilePeaks") {}

    ~AudioFilePeaks() override
    {
        stop();
    }

    // Starts scanning a file, replacing the previous one.
    // `notify` is called from the scan thread whenever more of the file has been scanned.
    void start(const char* const filename, const AudioFileReader::QuadMode quadMode,
               const NotifyFunc notify, void* const notifyPtr)
    {
        stop();

        const CarlaMutexLocker cml(fMutex);

        ADInfo info;
        ad_clear_nfo(&info);
        void* const file = ad_open(filename, &info);

        if (file == nullptr)
            return;

        if (info.channels == 0 || info.frames <= 0)
        {
            ad_free_nfo(&info);
            ad_close(file);
            return;
        }

        // a second handle for reading zoomed-in views while the scan thread uses the first
        ADInfo rawInfo;
        ad_clear_nfo(&rawInfo);
        fRawFile = ad_open(filename, &rawInfo);
        ad_free_nfo(&rawInfo);

        fScanFile = file;
        fInfo = info;
        fQuadMode = quadMode;
        fNumFrames = static_cast<uint64_t>(info.frames);

        fBucketFrames = kMinBucketFrames;
        while (fNumFrames / fBucketFrames >= kMaxBuckets)
            fBucketFrames *= 2;

        fNumBuckets = static_cast<uint32_t>((fNumFrames + fBucketFrames - 1) / fBucketFrames);
        fMins = new float[fNumBuckets];
        fMaxs = new float[fNumBuckets];
        fScannedBuckets.store(0);

        fNotify = notify;
        fNotifyPtr = notifyPtr;

        startThread();
    }

    void stop()
    {
        stopThread(5000);

        const CarlaMutexLocker cml(fMutex);

        if (fScanFile != nullptr)
        {
            ad_close(fScanFile);
            fScanFile = nullptr;
        }
        if (fRawFile != nullptr)
        {
            ad_close(fRawFile);
            fRawFile = nullptr;
        }

        ad_free_nfo(&fInfo);
        ad_clear_nfo(&fInfo);
        delete[] fMins;
        delete[] fMaxs;
        fMins = fMaxs = nullptr;
        fNumBuckets = 0;
        fNumFrames = 0;
        fScannedBuckets.store(0);
    }

    // Fills kViewPoints min/max pairs (interleaved) for [startPercent, endPercent] of the file.
    // Parts not scanned yet are flat. Returns the scan progress, 0 to 1.
    float computeView(float startPercent, float endPercent, float* const minmax)
    {
        carla_zeroFloats(minmax, kViewPoints * 2);

        const CarlaMutexLocker cml(fMutex);

        if (fNumBuckets == 0)
            return 0.f;

        startPercent = carla_fixedValue(0.f, 100.f, startPercent);
        endPercent = carla_fixedValue(0.f, 100.f, endPercent);
        if (endPercent <= startPercent)
            return progress();

        const double total = static_cast<double>(fNumFrames);
        const double first = static_cast<double>(startPercent) / 100.0 * total;
        const double last = static_cast<double>(endPercent) / 100.0 * total;
        const double framesPerPoint = (last - first) / kViewPoints;

        if (framesPerPoint < 2.0 * fBucketFrames && fRawFile != nullptr)
            readRawView(first, last, framesPerPoint, minmax);
        else
            readCachedView(first, framesPerPoint, minmax);

        return progress();
    }

private:
    static constexpr uint32_t kMinBucketFrames = 256;
    static constexpr uint32_t kMaxBuckets = 1U << 20;
    static constexpr uint32_t kBucketsPerRead = 64;
    static constexpr uint32_t kBucketsPerNotify = 4096;
    static constexpr uint32_t kRawBufferSize = 16384;

    CarlaMutex fMutex;
    void* fScanFile = nullptr;
    void* fRawFile = nullptr;
    ADInfo fInfo = {};
    AudioFileReader::QuadMode fQuadMode = AudioFileReader::kQuad1and2;

    uint64_t fNumFrames = 0;
    uint32_t fBucketFrames = kMinBucketFrames;
    uint32_t fNumBuckets = 0;
    float* fMins = nullptr;
    float* fMaxs = nullptr;
    std::atomic<uint32_t> fScannedBuckets { 0 };

    NotifyFunc fNotify = nullptr;
    void* fNotifyPtr = nullptr;

    // used by readRawView only, from the plugin idle (too big for the worker thread stack)
    float fRawBuffer[kRawBufferSize];

    float progress() const noexcept
    {
        return fNumBuckets != 0 ? static_cast<float>(fScannedBuckets.load()) / static_cast<float>(fNumBuckets) : 0.f;
    }

    // lowest and highest value of one interleaved frame, channels merged as for playback
    void mergeFrame(const float* const frame, float& lo, float& hi) const noexcept
    {
        float a, b;

        switch (fInfo.channels)
        {
        case 1:
            a = b = frame[0];
            break;
        case 2:
            a = frame[0];
            b = frame[1];
            break;
        case 4:
            if (fQuadMode == AudioFileReader::kQuadAll)
            {
                a = frame[0] + frame[2];
                b = frame[1] + frame[3];
            }
            else
            {
                const uint offset = fQuadMode == AudioFileReader::kQuad3and4 ? 2 : 0;
                a = frame[offset];
                b = frame[offset + 1];
            }
            break;
        default:
            a = b = frame[0];
            for (uint c = 1; c < fInfo.channels; ++c)
            {
                a = std::min(a, frame[c]);
                b = std::max(b, frame[c]);
            }
            break;
        }

        lo = std::min(lo, std::min(a, b));
        hi = std::max(hi, std::max(a, b));
    }

    void readCachedView(const double first, const double framesPerPoint, float* const minmax) const noexcept
    {
        const uint32_t scanned = fScannedBuckets.load(std::memory_order_acquire);

        for (uint32_t i = 0; i < kViewPoints; ++i)
        {
            uint32_t b0 = static_cast<uint32_t>((first + i * framesPerPoint) / fBucketFrames);
            uint32_t b1 = static_cast<uint32_t>((first + (i + 1) * framesPerPoint) / fBucketFrames);
            b1 = std::min(std::max(b1, b0 + 1), std::min(fNumBuckets, scanned));

            float lo = 1.f, hi = -1.f;
            for (uint32_t b = b0; b < b1; ++b)
            {
                lo = std::min(lo, fMins[b]);
                hi = std::max(hi, fMaxs[b]);
            }

            if (lo <= hi)
            {
                minmax[i * 2] = lo;
                minmax[i * 2 + 1] = hi;
            }
        }
    }

    void readRawView(const double first, const double last, const double framesPerPoint,
                     float* const minmax) noexcept
    {
        const uint channels = fInfo.channels;
        const uint64_t firstFrame = static_cast<uint64_t>(first);
        const uint64_t endFrame = std::min(fNumFrames, static_cast<uint64_t>(std::ceil(last)) + 1);

        if (ad_seek(fRawFile, static_cast<int64_t>(firstFrame)) < 0)
            return;

        float* const buffer = fRawBuffer;
        const uint32_t chunkFrames = kRawBufferSize / channels;

        float los[kViewPoints], his[kViewPoints];
        for (uint32_t i = 0; i < kViewPoints; ++i)
        {
            los[i] = 1.f;
            his[i] = -1.f;
        }

        for (uint64_t pos = firstFrame; pos < endFrame;)
        {
            const uint64_t wanted = std::min<uint64_t>(chunkFrames, endFrame - pos);
            const ssize_t samples = ad_read(fRawFile, buffer, static_cast<size_t>(wanted * channels));
            if (samples <= 0)
                break;

            const uint64_t frames = static_cast<uint64_t>(samples) / channels;

            for (uint64_t j = 0; j < frames; ++j, ++pos)
            {
                const double point = (static_cast<double>(pos) - first) / framesPerPoint;
                const uint32_t i = point <= 0.0 ? 0 : std::min(kViewPoints - 1, static_cast<uint32_t>(point));
                mergeFrame(buffer + j * channels, los[i], his[i]);
            }

            if (frames < wanted)
                break;
        }

        // zoomed in past one frame per pixel: pixels between two frames repeat the previous one
        float lo = 0.f, hi = 0.f;
        for (uint32_t i = 0; i < kViewPoints; ++i)
        {
            if (los[i] <= his[i])
            {
                lo = los[i];
                hi = his[i];
            }
            minmax[i * 2] = lo;
            minmax[i * 2 + 1] = hi;
        }
    }

    void run() override
    {
        const uint channels = fInfo.channels;
        const uint32_t framesPerRead = fBucketFrames * kBucketsPerRead;
        float* const buffer = new float[framesPerRead * channels];
        uint32_t notifiedAt = 0;

        for (uint32_t b = 0; b < fNumBuckets && ! shouldThreadExit(); b += kBucketsPerRead)
        {
            const uint32_t numBuckets = std::min(kBucketsPerRead, fNumBuckets - b);
            const uint64_t firstFrame = static_cast<uint64_t>(b) * fBucketFrames;
            const uint64_t wanted = std::min<uint64_t>(static_cast<uint64_t>(numBuckets) * fBucketFrames,
                                                       fNumFrames - firstFrame);
            const ssize_t samples = ad_read(fScanFile, buffer, static_cast<size_t>(wanted * channels));
            const uint64_t frames = samples > 0 ? static_cast<uint64_t>(samples) / channels : 0;

            for (uint32_t j = 0; j < numBuckets; ++j)
            {
                const uint64_t start = static_cast<uint64_t>(j) * fBucketFrames;
                const uint64_t end = std::min<uint64_t>(start + fBucketFrames, frames);

                float lo = 1.f, hi = -1.f;
                for (uint64_t f = start; f < end; ++f)
                    mergeFrame(buffer + f * channels, lo, hi);

                // short read (decoder error or end of data): flat
                if (lo > hi)
                    lo = hi = 0.f;

                fMins[b + j] = lo;
                fMaxs[b + j] = hi;
            }

            fScannedBuckets.store(b + numBuckets, std::memory_order_release);

            if (b + numBuckets - notifiedAt >= kBucketsPerNotify || b + numBuckets == fNumBuckets)
            {
                notifiedAt = b + numBuckets;
                if (fNotify != nullptr)
                    fNotify(fNotifyPtr);
            }
        }

        delete[] buffer;
    }

    CARLA_DECLARE_NON_COPYABLE(AudioFilePeaks)
};

// --------------------------------------------------------------------------------------------------------------------

#endif // AUDIO_FILE_PEAKS_HPP_INCLUDED
