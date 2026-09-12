import Foundation
import GameController

// ---------------------------------------------------------------------------
// Input
//
// The NES controller is eight switches, not eight events. Everything above
// this file is about turning whatever the player is holding into those eight
// booleans, and this file is where the two sources - the keyboard and a real
// gamepad - are merged.
//
// Two sources can hold the same switch at once. A key release must not let go
// of a button a pad is still pressing, so each source reports its own state
// and InputManager keeps the OR. The console only ever sees the combined
// result, and only when it changes.
// ---------------------------------------------------------------------------

/// The single place that decides what the eight buttons are doing.
///
/// This is deliberately not a pile of callbacks on the emulator. If every
/// source called `setButton` directly, releasing one would clobber the other,
/// and the bug would only show up when somebody used both at once.
final class InputManager {

    enum Source: Hashable {
        case keyboard
        case gamepad
    }

    private weak var emulator: Emulator?
    private var held: [Emulator.Button: Set<Source>] = [:]

    init(emulator: Emulator) {
        self.emulator = emulator
    }

    /// Press or release one button for one source. The emulator hears only
    /// the combined state, and only when it changes.
    func set(_ button: Emulator.Button, pressed: Bool, from source: Source) {
        var sources = held[button] ?? []
        if pressed {
            sources.insert(source)
        } else {
            sources.remove(source)
        }

        let isDown = !sources.isEmpty
        held[button] = isDown ? sources : nil
        emulator?.setButton(button, pressed: isDown)
    }

    /// Let go of everything one source was holding, and leave the other
    /// source alone. Losing keyboard focus must not drop a gamepad button.
    func releaseAll(from source: Source) {
        // Copy the keys first: `set` mutates `held`, and a dictionary cannot
        // be enumerated while it is being changed.
        for button in Array(held.keys) {
            set(button, pressed: false, from: source)
        }
    }

    /// Let go of everything on every source. Used on reset and on shutdown.
    func releaseEverything() {
        held.removeAll()
        emulator?.releaseAllButtons()
    }
}

// ---------------------------------------------------------------------------
// Real gamepads
// ---------------------------------------------------------------------------

/// Gamepads, through Apple's GameController framework.
///
/// The framework already knows how to talk to every wired and wireless pad
/// macOS supports, including the console-style ones that identify themselves
/// as `GCExtendedGamepad`. This class only has to map its button objects onto
/// the eight the console understands.
///
/// The interesting part is the lifecycle, not the mapping. A controller can
/// arrive in the middle of a game or leave it (battery, range, a cable), and
/// a pad that leaves must not leave a button stuck down. That is why connect
/// and disconnect both reset the gamepad source's state.
///
/// A pad is player one, port 0. The core already supports a second port; it
/// is unused because the games in the box are one player.
final class GamepadInput: NSObject {

    private let input: InputManager
    private var controllers: [ObjectIdentifier: GCController] = [:]

    init(input: InputManager) {
        self.input = input
        super.init()

        let center = NotificationCenter.default
        center.addObserver(self,
                           selector: #selector(controllerConnected(_:)),
                           name: .GCControllerDidConnect,
                           object: nil)
        center.addObserver(self,
                           selector: #selector(controllerDisconnected(_:)),
                           name: .GCControllerDidDisconnect,
                           object: nil)

        // A pad that was already plugged in never sends a connect
        // notification, so looking at the current list is not optional.
        for controller in GCController.controllers() {
            attach(controller)
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    var connectedCount: Int { controllers.count }

    // MARK: - Connect and disconnect

    @objc private func controllerConnected(_ note: Notification) {
        guard let controller = note.object as? GCController else { return }
        attach(controller)
    }

    @objc private func controllerDisconnected(_ note: Notification) {
        guard let controller = note.object as? GCController else { return }
        controllers[ObjectIdentifier(controller)] = nil
        input.releaseAll(from: .gamepad)
    }

    private func attach(_ controller: GCController) {
        controllers[ObjectIdentifier(controller)] = controller
        controller.playerIndex = .index1

        if let pad = controller.extendedGamepad {
            pad.valueChangedHandler = { [weak self] pad, _ in
                self?.apply(pad)
            }
        } else if let pad = controller.microGamepad {
            pad.valueChangedHandler = { [weak self] pad, _ in
                self?.apply(pad)
            }
        }
    }

    // MARK: - The mapping

    /// The console's three inputs - a d-pad and two face buttons - plus Start
    /// and Select. A modern pad has many more buttons; the extra ones have
    /// nowhere to go, which is a property of the console and not a bug.
    private func apply(_ pad: GCExtendedGamepad) {
        // The stick duplicates the d-pad, because most people reach for the
        // stick. The deadzone keeps a worn stick from drifting the player
        // across the level while nobody is touching it.
        let deadzone: Float = 0.5
        let stickX = pad.leftThumbstick.xAxis.value
        let stickY = pad.leftThumbstick.yAxis.value

        input.set(.left, pressed: pad.dpad.left.isPressed || stickX < -deadzone, from: .gamepad)
        input.set(.right, pressed: pad.dpad.right.isPressed || stickX > deadzone, from: .gamepad)
        input.set(.up, pressed: pad.dpad.up.isPressed || stickY > deadzone, from: .gamepad)
        input.set(.down, pressed: pad.dpad.down.isPressed || stickY < -deadzone, from: .gamepad)

        // A is the right face button on the console and on a Super Nintendo
        // pad. On an Xbox pad A is the bottom one; the physical position loss
        // is worth the name matching what the player reads on the button.
        input.set(.a, pressed: pad.buttonA.isPressed, from: .gamepad)
        input.set(.b, pressed: pad.buttonB.isPressed, from: .gamepad)

        input.set(.start, pressed: pad.buttonMenu.isPressed, from: .gamepad)
        input.set(.select, pressed: pad.buttonOptions?.isPressed ?? false, from: .gamepad)
    }

    /// The Siri Remote and other small pads expose three buttons and a d-pad.
    private func apply(_ pad: GCMicroGamepad) {
        input.set(.left, pressed: pad.dpad.left.isPressed, from: .gamepad)
        input.set(.right, pressed: pad.dpad.right.isPressed, from: .gamepad)
        input.set(.up, pressed: pad.dpad.up.isPressed, from: .gamepad)
        input.set(.down, pressed: pad.dpad.down.isPressed, from: .gamepad)

        input.set(.a, pressed: pad.buttonA.isPressed, from: .gamepad)
        input.set(.b, pressed: pad.buttonX.isPressed, from: .gamepad)
        input.set(.start, pressed: pad.buttonMenu.isPressed, from: .gamepad)
    }
}
