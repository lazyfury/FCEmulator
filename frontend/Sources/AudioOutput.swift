import AVFoundation
import Foundation

/// Feeding the speaker.
///
/// The shape of the problem: the emulator produces audio in bursts, one frame
/// at a time, whenever it happens to finish a frame. The sound card consumes
/// it at an absolutely fixed rate and does not tolerate being kept waiting.
/// Something has to sit in the middle, and that something is a ring buffer.
///
///     emulator thread   --write-->  ring buffer  --read-->  audio thread
///
/// Only the ring buffer is shared. The emulator itself is only ever touched
/// by the thread that runs it, which is what makes this simple.
///
/// The ring itself lives in C (fc_audio_queue_*), because a ring buffer shared
/// between an emulator thread and a real-time audio thread must not be guarded
/// by a mutex: if the emulator holds the lock for a moment, the callback blocks
/// and the speaker crackles. The C queue is a single producer / single
/// consumer queue built on release/acquire atomics, so neither side ever
/// waits. Swift cannot express those atomics directly, which is why the queue
/// sits on the C side of the interface.
final class AudioOutput {

    private let engine = AVAudioEngine()
    private var sourceNode: AVAudioSourceNode?

    private let queue: OpaquePointer?
    private let capacity: Int

    private(set) var isRunning = false

    init(capacity: Int = 32768) {
        self.capacity = capacity
        queue = fc_audio_queue_create(UInt32(capacity))
    }

    deinit {
        if let queue {
            fc_audio_queue_destroy(queue)
        }
    }

    /// How many times the callback had to hand back silence because the ring
    /// ran dry. The first thing to look at when the sound crackles.
    var underruns: UInt64 {
        queue.map { fc_audio_queue_underruns($0) } ?? 0
    }

    // MARK: - The ring buffer

    /// Called from the emulator thread.
    func push(_ samples: UnsafePointer<Float>, count: Int) {
        guard count > 0, let queue else { return }
        _ = fc_audio_queue_push(queue, samples, UInt32(count))
    }

    /// Called from the audio thread. The C side zero-fills any shortfall, so
    /// an underrun is a gap, never a burst of stale samples.
    private func pop(into out: UnsafeMutablePointer<Float>, count: Int) -> Int {
        guard let queue else {
            for i in 0..<count {
                out[i] = 0.0
            }
            return 0
        }
        return Int(fc_audio_queue_pop(queue, out, UInt32(count)))
    }

    // MARK: - Starting and stopping

    func start() {
        guard !isRunning else { return }

        let format = AVAudioFormat(standardFormatWithSampleRate: Double(Emulator.sampleRate),
                                   channels: 1)!

        let node = AVAudioSourceNode { [weak self] _, _, frameCount, audioBufferList -> OSStatus in
            let buffers = UnsafeMutableAudioBufferListPointer(audioBufferList)
            let frames = Int(frameCount)

            guard let self else {
                for buffer in buffers {
                    memset(buffer.mData, 0, Int(buffer.mDataByteSize))
                }
                return noErr
            }

            if let first = buffers.first,
               let data = first.mData?.assumingMemoryBound(to: Float.self) {
                _ = self.pop(into: data, count: frames)

                // Mono, so every other buffer gets the same thing. With a
                // standard format there is only ever one.
                for index in 1..<buffers.count {
                    if let other = buffers[index].mData {
                        memcpy(other, data, frames * MemoryLayout<Float>.size)
                    }
                }
            }
            return noErr
        }

        sourceNode = node
        engine.attach(node)
        engine.connect(node, to: engine.mainMixerNode, format: format)

        do {
            engine.prepare()
            try engine.start()
            isRunning = true
        } catch {
            FileHandle.standardError.write(
                "audio did not start: \(error.localizedDescription)\n".data(using: .utf8)!)
        }
    }

    func stop() {
        guard isRunning else { return }
        engine.stop()
        isRunning = false
    }

    /// How full the ring is, as a fraction. A front end can use this to nudge
    /// the emulator's speed, which is how you keep audio from drifting.
    var fill: Double {
        guard let queue else { return 0 }
        return Double(fc_audio_queue_fill(queue)) / Double(capacity)
    }
}
