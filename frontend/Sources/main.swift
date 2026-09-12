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

    gamepads:
      any controller macOS knows about is picked up automatically, and
      can come and go while the game is running
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

    /// macOS virtual key codes. These are positions on the keyboard, not
    /// characters, which is why they work the same on any layout.
    ///
    /// Two sets of keys do the same thing everywhere, because there is no
    /// single answer to "which key is A". Arrows or WASD for the d-pad, and
    /// either Z/X or J/K for the face buttons: Z/X mirrors the physical
    /// controller (left button on the left) and J/K is what the right hand
    /// wants if the left hand is on WASD.
    static let mapping: [UInt16: Emulator.Button] = [
        // d-pad - arrows (123/124/125/126 are left/right/down/up)
        123: .left, 124: .right, 125: .down, 126: .up,

        // d-pad - WASD (0/1/2/13 are A/S/D/W)
        0: .left, 2: .right, 1: .down, 13: .up,

        // B is the left face button, A is the right one, same as the pad
        6: .b, 38: .b,     // Z, J
        7: .a, 40: .a,     // X, K

        // Start and Select
        36: .start,        // Return
        49: .start,        // Space
        48: .select,       // Tab
        60: .select,       // Right shift
    ]

    /// Keys that do something other than a button.
    enum Command: UInt16 {
        case reset = 15        // R
        case screenshot = 111  // F12
        case toggleSpeed = 3   // F
    }

    func button(for keyCode: UInt16) -> Emulator.Button? {
        Keyboard.mapping[keyCode]
    }

    /// Returns true if the key was one we care about.
    @discardableResult
    func keyDown(keyCode: UInt16, input: InputManager) -> Bool {
        guard let button = button(for: keyCode) else { return false }
        pressed.insert(keyCode)
        input.set(button, pressed: true, from: .keyboard)
        return true
    }

    @discardableResult
    func keyUp(keyCode: UInt16, input: InputManager) -> Bool {
        guard let button = button(for: keyCode) else { return false }
        pressed.remove(keyCode)
        input.set(button, pressed: false, from: .keyboard)
        return true
    }

    /// Losing focus releases the keys, but not a gamepad the player is still
    /// holding: that is a different source.
    func releaseAll(input: InputManager) {
        pressed.removeAll()
        input.releaseAll(from: .keyboard)
    }
}

// MARK: - The view

final class EmulatorView: MTKView {

    var keyboard: Keyboard?
    var input: InputManager?

    /// Keys that are not buttons.
    var onReset: (() -> Void)?
    var onScreenshot: (() -> Void)?
    var onToggleSpeed: (() -> Void)?

    override var acceptsFirstResponder: Bool { true }

    /// Clicking the picture should give it the keyboard back, because the
    /// first thing anyone does when the controls stop working is click on
    /// the window.
    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        super.mouseDown(with: event)
    }

    override func keyDown(with event: NSEvent) {
        guard let keyboard, let input else { return }

        if keyboard.keyDown(keyCode: event.keyCode, input: input) {
            return
        }

        switch Keyboard.Command(rawValue: event.keyCode) {
        case .reset:
            onReset?()
        case .screenshot:
            onScreenshot?()
        case .toggleSpeed:
            onToggleSpeed?()
        case nil:
            // Let the system have anything we do not use, so Cmd-Q and the
            // rest of the menu still work.
            super.keyDown(with: event)
        }
    }

    override func keyUp(with event: NSEvent) {
        guard let keyboard, let input else { return }
        if !keyboard.keyUp(keyCode: event.keyCode, input: input) {
            super.keyUp(with: event)
        }
    }

    /// Losing focus must release everything, or the last key you held stays
    /// held forever while the game keeps running.
    override func resignFirstResponder() -> Bool {
        if let keyboard, let input {
            keyboard.releaseAll(input: input)
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
    private var input: InputManager?
    private var gamepad: GamepadInput?

    private var emulator: Emulator?
    private var frameBuffer = [Float](repeating: 0, count: 8192)

    private var screenshotCounter = 0
    private var framesPerTick = 1
    private var titleTick = 0
    private var lastTitleUpdate = Date()

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let emulator else { return }

        guard let device = MTLCreateSystemDefaultDevice() else {
            FileHandle.standardError.write("no Metal device\n".data(using: .utf8)!)
            NSApp.terminate(nil)
            return
        }
        guard let renderer = Renderer(device: device) else {
            FileHandle.standardError.write(
                "could not build the renderer\n".data(using: .utf8)!)
            NSApp.terminate(nil)
            return
        }
        self.renderer = renderer

        // One manager for every source: the keyboard and any gamepads all
        // report into it, and it keeps the console's eight switches straight.
        let input = InputManager(emulator: emulator)
        self.input = input
        let gamepad = GamepadInput(input: input)
        self.gamepad = gamepad

        let view = EmulatorView(frame: NSRect(x: 0, y: 0,
                                              width: Emulator.width * 3,
                                              height: Emulator.height * 3),
                                device: device)
        view.colorPixelFormat = .bgra8Unorm
        view.isPaused = false
        view.enableSetNeedsDisplay = false
        // 60, because that is what the console did. A faster display would
        // otherwise run the game at double speed.
        view.preferredFramesPerSecond = 60
        view.keyboard = keyboard
        view.input = input
        view.delegate = renderer

        view.onReset = { [weak self] in
            self?.emulator?.reset()
        }
        view.onScreenshot = { [weak self] in
            self?.takeScreenshot()
        }
        view.onToggleSpeed = { [weak self] in
            guard let self else { return }
            self.framesPerTick = (self.framesPerTick == 1) ? 2 : 1
        }

        // The emulator's clock: one frame per displayed frame, then the
        // picture goes straight to the GPU.
        // MTKView calls this from the main thread, so the window's title and
        // the rest of the UI work are safe here. Swift 6 wants to be told.
        renderer.onFrame = { [weak self] in
          MainActor.assumeIsolated {
            guard let self, let emulator = self.emulator else { return }

            for _ in 0..<self.framesPerTick {
                if !emulator.runFrame() {
                    // The core halted, which means the emulator has a bug.
                    // Say so instead of showing a frozen picture silently.
                    self.window?.title = "FCEmulator - the CPU halted (emulator bug)"
                    return
                }
            }
            self.titleTick += 1

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
            self.updateTitle()
          }
        }
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
        window.title = "FCEmulator"
        window.contentView = view
        window.makeKeyAndOrderFront(nil)
        window.center()
        window.makeFirstResponder(view)
        window.acceptsMouseMovedEvents = true
        self.window = window

        NSApp.activate(ignoringOtherApps: true)
    }

    /// The title bar doubles as a status line: frames per second, so a
    /// machine running at the wrong speed is obvious, and the audio buffer's
    /// fill, so a starving speaker is obvious too.
    @MainActor private func updateTitle() {
        let now = Date()
        let elapsed = now.timeIntervalSince(lastTitleUpdate)
        guard elapsed >= 0.5 else { return }

        let fps = Double(titleTick) / elapsed
        titleTick = 0
        lastTitleUpdate = now

        guard let emulator else { return }
        let fill = audio.map { Int($0.fill * 100) } ?? 0
        let underruns = audio?.underruns ?? 0
        let pads = gamepad?.connectedCount ?? 0
        let speed = framesPerTick == 1 ? "" : "  [fast forward]"
        let pad = pads > 0 ? "  -  pad \(pads)" : ""
        window?.title = String(
            format: "FCEmulator  -  %.1f fps  -  frame %d  -  audio %d%%  -  underruns %llu%@%@",
            fps, emulator.frameCount, fill, underruns, speed, pad)
    }

    /// Write what the core produced, not what the window shows.
    ///
    /// This is the point of it: if the saved file looks right and the window
    /// does not, the problem is in Metal. If they look the same, it is in the
    /// core. Without this there is no way to tell the two apart.
    private func takeScreenshot() {
        guard let emulator, let framebuffer = emulator.framebuffer else { return }

        screenshotCounter += 1
        let name = String(format: "shot_%04d.ppm", screenshotCounter)
        let directory = FileManager.default.currentDirectoryPath
        let path = (directory as NSString).appendingPathComponent(name)

        if writePPM(path: path, framebuffer: framebuffer) {
            print("screenshot: \(path)  (frame \(emulator.frameCount))")
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        input?.releaseEverything()
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
