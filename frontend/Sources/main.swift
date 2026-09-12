import AppKit
import Foundation
import MetalKit

// ---------------------------------------------------------------------------
// FCEmulator
//
// Two ways to run.
//
//   FCEmulator game.nes                 a window you can play in
//   FCEmulator game.nes --headless 400 --dump out.ppm
//                                       no window, just run and write a frame
//
// The second one exists for two reasons. It makes the whole front end
// testable without a display, and it is the fastest way to find out whether a
// problem is in the core or in the window: if --headless draws the right
// picture, the core is fine.
// ---------------------------------------------------------------------------

// MARK: - Command line

struct Options {
    var romPath: String?
    var headlessFrames = 0
    var dumpPath: String?
    var holdStart = false
    var showHelp = false
}

func parseArguments() -> Options {
    var options = Options()
    var arguments = Array(CommandLine.arguments.dropFirst())

    while !arguments.isEmpty {
        let argument = arguments.removeFirst()
        switch argument {
        case "--headless":
            if let value = arguments.first, let frames = Int(value) {
                options.headlessFrames = frames
                arguments.removeFirst()
            } else {
                options.headlessFrames = 1
            }
        case "--dump":
            if let value = arguments.first {
                options.dumpPath = value
                arguments.removeFirst()
            }
        case "--start":
            // Press Start for a few frames partway through, which is how a
            // script gets past a title screen.
            options.holdStart = true
        case "--help", "-h":
            options.showHelp = true
        default:
            if options.romPath == nil {
                options.romPath = argument
            }
        }
    }
    return options
}

func printUsage() {
    print("""
    FCEmulator - a NES emulator

    usage:
      FCEmulator <rom.nes>                                  play it
      FCEmulator <rom.nes> --headless <frames> [--dump f.ppm] [--start]

    keys:
      arrow keys / WASD   d-pad
      Z or K              A
      X or J              B
      return              Start
      right shift         Select
      R                   reset
    """)
}

// MARK: - A PPM, so the headless mode has something to show

func writePPM(path: String, framebuffer: UnsafePointer<UInt32>) -> Bool {
    var bytes = [UInt8]()
    bytes.reserveCapacity(Emulator.width * Emulator.height * 3)

    for y in 0..<Emulator.height {
        for x in 0..<Emulator.width {
            let pixel = framebuffer[y * Emulator.width + x]
            bytes.append(UInt8((pixel >> 16) & 0xFF))
            bytes.append(UInt8((pixel >> 8) & 0xFF))
            bytes.append(UInt8(pixel & 0xFF))
        }
    }

    let header = "P6\n\(Emulator.width) \(Emulator.height)\n255\n"
    var data = Data(header.utf8)
    data.append(contentsOf: bytes)

    do {
        try data.write(to: URL(fileURLWithPath: path))
        return true
    } catch {
        FileHandle.standardError.write(
            "could not write \(path): \(error)\n".data(using: .utf8)!)
        return false
    }
}

func runHeadless(emulator: Emulator, options: Options) -> Int32 {
    var audio = [Float](repeating: 0, count: 8192)
    var audibleFrames = 0
    var peak: Float = 0
    var frames = 0

    for frame in 0..<options.headlessFrames {
        if frame == 100 && options.holdStart {
            emulator.setButton(.start, pressed: true)
        }
        if frame == 105 && options.holdStart {
            emulator.setButton(.start, pressed: false)
        }

        if !emulator.runFrame() {
            FileHandle.standardError.write(
                "the CPU halted at frame \(frame)\n".data(using: .utf8)!)
            break
        }
        frames += 1

        // Drain the audio so the queue does not grow without bound. In the
        // windowed build these samples go to the speaker; here they are only
        // measured, which is how the headless mode can say whether the game
        // is making noise.
        let taken = emulator.takeSamples(into: &audio, count: audio.count)
        if taken > 0 {
            var loud = false
            for i in 0..<taken {
                let sample = audio[i]
                if sample > peak { peak = sample }
                if sample > 0.01 { loud = true }
            }
            if loud { audibleFrames += 1 }
        }
    }

    print("frames run      : \(frames)")
    print("frame counter   : \(emulator.frameCount)")
    print("cpu cycles      : \(emulator.totalCycles)")
    print("cpu pc          : \(String(format: "$%04X", emulator.cpuPC))")
    print("halted          : \(emulator.isHalted)")
    print("audio peak      : \(String(format: "%.3f", peak))")
    print("frames audible  : \(audibleFrames)")

    if let dumpPath = options.dumpPath, let framebuffer = emulator.framebuffer {
        if writePPM(path: dumpPath, framebuffer: framebuffer) {
            print("wrote           : \(dumpPath)")
        } else {
            return 1
        }
    }
    return emulator.isHalted ? 1 : 0
}

// MARK: - Keyboard

/// Turns key presses into button presses.
///
/// Note what is NOT here: no repeat rate, no turbo, no debouncing, no
/// combinations. The hardware has none of those, so neither does this. If a
/// front end wants them they belong here, or in the game, but never in the
/// core's Controller.
final class Keyboard {

    private(set) var pressed = Set<UInt16>()

    static let mapping: [UInt16: Emulator.Button] = [
        // Arrow keys and WASD both work, because both are reasonable.
        123: .left, 124: .right, 125: .down, 126: .up,
        0: .a, 13: .b,           // A, S
        6: .a, 38: .b,           // Z, J
        40: .b,                  // K
        1: .b, 37: .a,           // S, L
        36: .start,              // Return
        60: .select,             // Right shift
    ]

    func button(for keyCode: UInt16) -> Emulator.Button? {
        Keyboard.mapping[keyCode]
    }

    /// Returns true if the key was one we care about.
    @discardableResult
    func keyDown(keyCode: UInt16, emulator: Emulator) -> Bool {
        guard let button = button(for: keyCode) else { return false }
        pressed.insert(keyCode)
        emulator.setButton(button, pressed: true)
        return true
    }

    @discardableResult
    func keyUp(keyCode: UInt16, emulator: Emulator) -> Bool {
        guard let button = button(for: keyCode) else { return false }
        pressed.remove(keyCode)
        emulator.setButton(button, pressed: false)
        return true
    }

    func releaseAll(emulator: Emulator) {
        pressed.removeAll()
        emulator.releaseAllButtons()
    }
}

// MARK: - The view

final class EmulatorView: MTKView {

    var keyboard: Keyboard?
    var emulator: Emulator?

    override var acceptsFirstResponder: Bool { true }

    override func keyDown(with event: NSEvent) {
        guard let keyboard, let emulator else { return }
        if keyboard.keyDown(keyCode: event.keyCode, emulator: emulator) {
            return
        }
        if event.keyCode == 15 {   // R
            emulator.reset()
            return
        }
        super.keyDown(with: event)
    }

    override func keyUp(with event: NSEvent) {
        guard let keyboard, let emulator else { return }
        if !keyboard.keyUp(keyCode: event.keyCode, emulator: emulator) {
            super.keyUp(with: event)
        }
    }

    /// Losing focus must release everything, or the last key you held stays
    /// held forever while the game keeps running.
    override func resignFirstResponder() -> Bool {
        if let keyboard, let emulator {
            keyboard.releaseAll(emulator: emulator)
        }
        return super.resignFirstResponder()
    }
}

// MARK: - The window

final class AppDelegate: NSObject, NSApplicationDelegate {

    private var window: NSWindow?
    private var view: EmulatorView?
    private var renderer: Renderer?
    private var audio: AudioOutput?
    private let keyboard = Keyboard()

    private var emulator: Emulator?
    private var frameBuffer = [Float](repeating: 0, count: 8192)

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let emulator else { return }

        guard let device = MTLCreateSystemDefaultDevice() else {
            FileHandle.standardError.write("no Metal device\n".data(using: .utf8)!)
            NSApp.terminate(nil)
            return
        }
        guard let renderer = Renderer(device: device) else {
            FileHandle.standardError.write("could not build the renderer\n".data(using: .utf8)!)
            NSApp.terminate(nil)
            return
        }
        self.renderer = renderer

        let view = EmulatorView(frame: NSRect(x: 0, y: 0,
                                              width: Emulator.width * 3,
                                              height: Emulator.height * 3),
                                device: device)
        view.colorPixelFormat = .bgra8Unorm
        view.isPaused = false
        view.enableSetNeedsDisplay = false
        view.preferredFramesPerSecond = 60
        view.keyboard = keyboard
        view.emulator = emulator
        view.delegate = renderer

        // The emulator's clock: one frame per displayed frame, then the
        // picture goes straight to the GPU.
        renderer.onFrame = { [weak self] in
            guard let self, let emulator = self.emulator else { return }

            if !emulator.runFrame() {
                // The core halted, which means the emulator has a bug. Say so
                // instead of showing a frozen picture with no explanation.
                self.window?.title = "FCEmulator - the CPU halted (emulator bug)"
                return
            }

            // Hand the audio over, then drop it. The core produces it a frame
            // at a time; the ring buffer smooths that out for the speaker.
            if let audio = self.audio {
                let taken = emulator.takeSamples(into: &self.frameBuffer,
                                                 count: self.frameBuffer.count)
                if taken > 0 {
                    self.frameBuffer.withUnsafeBufferPointer { buffer in
                        audio.push(buffer.baseAddress!, count: taken)
                    }
                }
            }
            renderer.framebuffer = emulator.framebuffer
        }
        // MTKView's own draw callback runs after onFrame, so the texture is
        // uploaded with the frame that was just produced.
        renderer.framebuffer = emulator.framebuffer

        self.view = view

        let audio = AudioOutput()
        self.audio = audio
        audio.start()

        let window = NSWindow(
            contentRect: view.frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false)
        window.title = "FCEmulator - \(emulator.romSummary)"
        window.contentView = view
        window.makeKeyAndOrderFront(nil)
        window.center()
        window.makeFirstResponder(view)
        self.window = window

        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationWillTerminate(_ notification: Notification) {
        audio?.stop()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func setEmulator(_ emulator: Emulator) {
        self.emulator = emulator
    }
}

// MARK: - Entry point

let options = parseArguments()

if options.showHelp || options.romPath == nil {
    printUsage()
    exit(options.romPath == nil && !options.showHelp ? 1 : 0)
}

let emulator = Emulator()

guard let romPath = options.romPath, emulator.load(romAt: romPath) else {
    FileHandle.standardError.write(
        "could not load \(options.romPath ?? "?"): \(emulator.lastError)\n"
            .data(using: .utf8)!)
    exit(1)
}

if options.headlessFrames > 0 {
    exit(runHeadless(emulator: emulator, options: options))
}

let application = NSApplication.shared
let delegate = AppDelegate()
delegate.setEmulator(emulator)
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
