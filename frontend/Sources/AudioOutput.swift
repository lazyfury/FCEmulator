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
/// The lock below is the one thing here that a real emulator would do
/// differently. A lock in an audio callback is a real-time violation: if the
/// emulator thread holds it, the callback blocks and the speaker glitches.
/// The fix is a lock free single producer single consumer queue, which is
/// about thirty lines of atomics. It is on the list, and it is written down
/// here rather than quietly ignored.
final class AudioOutput {

    private let engine = AVAudioEngine()
    private var sourceNode: AVAudioSourceNode?

    private let lock = NSLock()
    private var ring: [Float]
    private var readIndex = 0
    private var writeIndex = 0
    private var available = 0

    private(set) var isRunning = false

    /// Set when the callback had to hand back silence because the ring ran
    /// dry. A front end can show this, and it is the first thing to look at
    /// when the sound crackles.
    private(set) var underruns = 0

    init(capacity: Int = 32768) {
        ring = [Float](repeating: 0, count: capacity)
    }

    // MARK: - The ring buffer

    private var capacity: Int { ring.count }

    /// Called from the emulator thread.
    func push(_ samples: UnsafePointer<Float>, count: Int) {
        guard count > 0 else { return }

        lock.lock()
        defer { lock.unlock() }

        for i in 0..<count {
            if available == capacity {
                // The ring is full, which means the audio hardware is not
                // keeping up. Drop the oldest sample rather than the newest:
                // a tiny skip is better than falling further behind.
                readIndex = (readIndex + 1) % capacity
                available -= 1
            }
            ring[writeIndex] = samples[i]
            writeIndex = (writeIndex + 1) % capacity
            available += 1
        }
    }

    /// Called from the audio thread.
    private func pop(into out: UnsafeMutablePointer<Float>, count: Int) -> Int {
        lock.lock()
        defer { lock.unlock() }

        let taken = min(count, available)
        for i in 0..<taken {
            out[i] = ring[readIndex]
            readIndex = (readIndex + 1) % capacity
        }
        available -= taken

        if taken < count {
            for i in taken..<count {
                out[i] = 0.0
            }
            underruns += 1
        }
        return taken
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
        lock.lock()
        defer { lock.unlock() }
        return Double(available) / Double(capacity)
    }
}
