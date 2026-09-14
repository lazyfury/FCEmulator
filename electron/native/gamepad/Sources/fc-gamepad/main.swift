// ---------------------------------------------------------------------------
// fc-gamepad -- the console's controller port, read from a real pad.
//
// One job: turn whatever a player is holding into the eight switches of an NES
// controller, and say so on stdout. It knows nothing about the emulator, the
// Electron process, or what a button press does; it only reports.
//
// The output is JSON Lines -- one object per line, flushed immediately, so a
// reader on the other end can parse it with a loop and a `JSON.parse`. The
// three messages are:
//
//   {"type":"hello","version":1,"pid":1234}
//       Once, at startup. Its arrival is the only proof the helper is alive,
//       which is worth having when a pad "does not work".
//
//   {"type":"pad","connected":true,"id":"Xbox Wireless Controller","buttons":{
//        "A":true,"B":false,"SELECT":false,"START":false,
//        "UP":false,"DOWN":false,"LEFT":false,"RIGHT":false}}
//       On connect, and then only when something changes. Polling happens at
//       60Hz, but a steady stream of "nothing changed" would be noise on a
//       pipe that the other end has to parse, so it is filtered here.
//
//   {"type":"pad","connected":false}
//       When the pad goes away -- unplugged, out of battery, out of range. A
//       pad that disappears must say so, or the jump button stays held
//       forever: there is nobody left to release it.
//
// The mapping is deliberately the same one the Swift front end uses
// (frontend/Sources/Input.swift). A stick duplicates the d-pad because most
// people reach for the stick; the deadzone is 0.5 because a worn stick drifts
// and a drifting stick walks the player into a wall. A is the right hand face
// button, which is index 0 on a modern pad -- the one with the letter A printed
// on it.
//
// stdin is a signal, not input: when the parent closes it, this exits. That is
// what stops a killed Electron from leaving an orphan process behind.
// ---------------------------------------------------------------------------

import Foundation
import GameController

/// The eight names, and the order is the order of the protocol. It is also the
/// order src/ffi/emulator_api.h's enum uses, so the whole chain -- helper,
/// main process, renderer, core -- agrees on which switch is which.
private let buttonNames = ["A", "B", "SELECT", "START", "UP", "DOWN", "LEFT", "RIGHT"]

/// Everything up, which is also the starting state and the "pad has gone" state.
private func allReleased() -> [String: Bool] {
    var buttons = [String: Bool]()
    for name in buttonNames {
        buttons[name] = false
    }
    return buttons
}

/// One JSON object, one line, on stdout, now.
///
/// FileHandle rather than `print` because stdout is a pipe here, and a pipe is
/// buffered: a `print` that sits in a 4KB buffer until the buffer fills is a
/// button press that arrives seconds late, or never if the process is idle.
private func emit(_ object: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(object),
          let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    else {
        return
    }
    var line = data
    line.append(0x0A)
    FileHandle.standardOutput.write(line)
}

/// What a pad is doing right now, in the console's terms.
///
/// This is a `struct` and not just a dictionary so that "has anything changed"
/// is a value comparison rather than a hand-written field-by-field check that
/// somebody will eventually forget to extend.
private struct Reading: Equatable {
    var connected: Bool
    var identifier: String
    var buttons: [String: Bool]

    static let gone = Reading(connected: false, identifier: "", buttons: allReleased())
}

/// Reads the first pad it can find, and reports the changes.
///
/// One pad, because the console's player one is on port 0 and the core's second
/// port is unused by every game in the box. A second pad would be the same code
/// with a controller index, and it is not here because nothing would test it.
private final class PadReporter {
    private var last = Reading.gone
    private var discoveryStarted = false

    func poll() {
        // Wireless discovery is what makes a pad that is switched on *after*
        // the application started show up. It is started once, lazily, rather
        // than at process start: with nothing to find there is no reason to
        // have the framework's radio scanning. Asking it repeatedly would
        // restart the scan every frame.
        if !discoveryStarted {
            discoveryStarted = true
            GCController.startWirelessControllerDiscovery(completionHandler: nil)
        }

        // Already-connected pads and newly-connected ones both appear here;
        // the framework keeps the list current.
        guard let controller = GCController.controllers().first,
              let buttons = read(controller)
        else {
            if last.connected {
                // The pad went away. Let go of everything, loudly.
                last = .gone
                emit(["type": "pad", "connected": false])
            }
            return
        }

        let current = Reading(
            connected: true,
            identifier: describe(controller),
            buttons: buttons
        )
        guard current != last else {
            return
        }
        last = current
        emit([
            "type": "pad",
            "connected": true,
            "id": current.identifier,
            "buttons": current.buttons,
        ])
    }

    /// What to call this pad in the log and on the settings screen.
    ///
    /// `vendorName` is "Xbox Wireless Controller"; `productCategory` is the
    /// class the framework put it in, such as "Xbox One" or "DualShock". Either
    /// can be empty, and a pad with no name at all is still a pad.
    private func describe(_ controller: GCController) -> String {
        var parts: [String] = []
        if let vendor = controller.vendorName, !vendor.isEmpty {
            parts.append(vendor)
        }
        if !controller.productCategory.isEmpty {
            parts.append(controller.productCategory)
        }
        return parts.isEmpty ? "Gamepad" : parts.joined(separator: " ")
    }

    /// The eight switches, from whichever shape the framework handed over.
    ///
    /// A modern pad is `GCExtendedGamepad`: a d-pad, two sticks, four face
    /// buttons, shoulders and a menu. The Siri Remote and other small pads are
    /// `GCMicroGamepad`: a d-pad, two buttons and a menu. Anything else --
    /// a steering wheel, a flight stick -- has no mapping onto an NES
    /// controller at all and is ignored rather than guessed at.
    private func read(_ controller: GCController) -> [String: Bool]? {
        if let pad = controller.extendedGamepad {
            // Most people reach for the stick even when there is a d-pad, so
            // the stick duplicates it. The deadzone is what keeps a worn stick
            // at rest from walking the player into a wall.
            let deadzone: Float = 0.5
            let x = pad.leftThumbstick.xAxis.value
            // Axis values are +1 up and -1 down, unlike the browser's Gamepad
            // API where +1 is down. The sign flip is here and nowhere else.
            let y = pad.leftThumbstick.yAxis.value

            var buttons = allReleased()
            buttons["LEFT"] = pad.dpad.left.isPressed || x < -deadzone
            buttons["RIGHT"] = pad.dpad.right.isPressed || x > deadzone
            buttons["UP"] = pad.dpad.up.isPressed || y > deadzone
            buttons["DOWN"] = pad.dpad.down.isPressed || y < -deadzone

            buttons["A"] = pad.buttonA.isPressed
            buttons["B"] = pad.buttonB.isPressed
            buttons["START"] = pad.buttonMenu.isPressed
            buttons["SELECT"] = pad.buttonOptions?.isPressed ?? false
            return buttons
        }

        if let pad = controller.microGamepad {
            var buttons = allReleased()
            buttons["LEFT"] = pad.dpad.left.isPressed
            buttons["RIGHT"] = pad.dpad.right.isPressed
            buttons["UP"] = pad.dpad.up.isPressed
            buttons["DOWN"] = pad.dpad.down.isPressed
            buttons["A"] = pad.buttonA.isPressed
            buttons["B"] = pad.buttonX.isPressed
            buttons["START"] = pad.buttonMenu.isPressed
            // The micro pad has no Select. Left up is the honest answer.
            return buttons
        }

        return nil
    }
}

// ---------------------------------------------------------------------------
// Life
// ---------------------------------------------------------------------------

emit(["type": "hello", "version": 1, "pid": ProcessInfo.processInfo.processIdentifier])

// stdin is a watchdog. The parent keeps it open for as long as it wants the
// helper to live; when it exits, the pipe closes and this read returns nil.
// Breaking out of the loop is the clean exit, and it is worth having because
// the alternative -- an orphan process still holding the HID connection after
// the application is gone -- is exactly the kind of thing this whole file was
// written to avoid.
DispatchQueue.global(qos: .utility).async {
    while readLine(strippingNewline: true) != nil {}
    exit(0)
}

private let reporter = PadReporter()
let timer = Timer(timeInterval: 1.0 / 60.0, repeats: true) { _ in
    reporter.poll()
}
// `.common` rather than the default mode: the default is suspended while a
// menu or a window drag is being tracked, and a pad that stops reporting
// mid-drag is a pad that looks broken.
RunLoop.main.add(timer, forMode: .common)
RunLoop.main.run()
