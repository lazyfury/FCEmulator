import Foundation

/// A single NES, wrapped.
///
/// Everything below this class is C. Nothing in this file knows how a PPU
/// works, and nothing below it knows that Swift exists. That is the whole
/// point of the C interface: the emulator could be driven by a different
/// language tomorrow without changing a line of the core.
final class Emulator {

    /// A controller button, matching the C enum.
    enum Button: Int32 {
        case a = 0, b, select, start, up, down, left, right

        var name: String {
            switch self {
            case .a: return "A"
            case .b: return "B"
            case .select: return "Select"
            case .start: return "Start"
            case .up: return "Up"
            case .down: return "Down"
            case .left: return "Left"
            case .right: return "Right"
            }
        }

        var cValue: fc_button { fc_button(UInt32(rawValue)) }
    }

    static let width = Int(FC_SCREEN_WIDTH)
    static let height = Int(FC_SCREEN_HEIGHT)

    private let handle: OpaquePointer
    private(set) var isLoaded = false

    /// The last error the core reported, or "" if there was none.
    var lastError: String {
        String(cString: fc_last_error(handle))
    }

    /// A one line description of the cartridge, or "" if nothing is loaded.
    var romSummary: String {
        String(cString: fc_rom_summary(handle))
    }

    init() {
        guard let created = fc_create() else {
            // fc_create only fails if the process is out of memory, in which
            // case there is nothing useful left to do.
            fatalError("could not create the emulator")
        }
        handle = created
    }

    deinit {
        fc_destroy(handle)
    }

    // MARK: - Loading

    @discardableResult
    func load(romAt path: String) -> Bool {
        guard let data = FileManager.default.contents(atPath: path) else {
            return false
        }
        return load(rom: data)
    }

    @discardableResult
    func load(rom data: Data) -> Bool {
        let ok = data.withUnsafeBytes { buffer -> Bool in
            guard let base = buffer.bindMemory(to: UInt8.self).baseAddress else {
                return false
            }
            return fc_load_rom(handle, base, data.count)
        }
        isLoaded = ok
        return ok
    }

    // MARK: - Running

    /// Run one frame. Returns false if the CPU halted, which means the
    /// emulator hit an opcode it does not implement.
    @discardableResult
    func runFrame() -> Bool {
        fc_run_frame(handle)
    }

    var isHalted: Bool { fc_is_halted(handle) }
    var frameCount: Int { Int(fc_frame_count(handle)) }
    var totalCycles: UInt64 { fc_total_cycles(handle) }
    var cpuPC: UInt16 { fc_cpu_pc(handle) }

    func reset() {
        fc_reset(handle)
    }

    // MARK: - Video

    /// The framebuffer, 256 x 240, 0x00RRGGBB, top row first.
    ///
    /// The pointer belongs to the emulator and stays valid for its lifetime,
    /// so a renderer caches it once and re-reads the contents every frame.
    /// No copy happens in the core and none happens here.
    var framebuffer: UnsafePointer<UInt32>? {
        fc_framebuffer(handle)
    }

    // MARK: - Audio

    static var sampleRate: Int { Int(fc_sample_rate()) }

    /// Copy up to `count` samples out. Safe to call from an audio thread:
    /// no allocation, no locks on the core side.
    @discardableResult
    func takeSamples(into buffer: UnsafeMutablePointer<Float>, count: Int) -> Int {
        Int(fc_take_samples(handle, buffer, count))
    }

    var samplesPending: Int { Int(fc_samples_pending(handle)) }

    func clearSamples() {
        fc_clear_samples(handle)
    }

    // MARK: - Input

    func setButton(_ button: Button, pressed: Bool, port: Int32 = 0) {
        fc_set_button(handle, button.cValue, pressed, port)
    }

    func releaseAllButtons() {
        fc_release_all_buttons(handle)
    }
}
