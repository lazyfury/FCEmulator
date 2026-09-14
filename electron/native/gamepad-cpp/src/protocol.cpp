#include "protocol.h"

#include <cstddef>
#include <cstdio>
#include <sstream>

namespace fc {

const char* const kButtonNames[8] = {
    "A", "B", "SELECT", "START", "UP", "DOWN", "LEFT", "RIGHT",
};

namespace {

/// The named switch at a fixed position. The loop below walks the list by
/// position, so the switch has to be able to answer "the n-th one?", and this
/// is the one place that knows the correspondence.
bool buttonAt(const PadButtons& buttons, int index) {
    switch (index) {
        case 0: return buttons.A;
        case 1: return buttons.B;
        case 2: return buttons.SELECT;
        case 3: return buttons.START;
        case 4: return buttons.UP;
        case 5: return buttons.DOWN;
        case 6: return buttons.LEFT;
        default: return buttons.RIGHT;
    }
}

}  // namespace

std::string jsonString(const std::string& value) {
    std::string out;
    out.push_back('"');
    for (const char raw : value) {
        const auto byte = static_cast<unsigned char>(raw);
        switch (byte) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\b': out += "\\b"; break;
            case '\f': out += "\\f"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (byte < 0x20) {
                    // The control characters JSON has no short escape for.
                    char escape[7];
                    std::snprintf(escape, sizeof escape, "\\u%04x", byte);
                    out += escape;
                } else {
                    // Everything else, including every byte of a UTF-8
                    // sequence, goes through untouched.
                    out.push_back(raw);
                }
        }
    }
    out.push_back('"');
    return out;
}

std::string helloMessage(long long pid) {
    std::ostringstream out;
    out << "{\"pid\":" << pid << ",\"type\":\"hello\",\"version\":2}";
    return out.str();
}

std::string padsMessage(const std::vector<PadReading>& pads) {
    std::ostringstream out;
    out << "{\"type\":\"pads\",\"pads\":[";
    for (std::size_t position = 0; position < pads.size(); ++position) {
        if (position != 0) {
            out << ',';
        }
        const PadReading& pad = pads[position];
        out << "{\"index\":" << pad.index
            << ",\"id\":" << jsonString(pad.id)
            << ",\"buttons\":{";
        for (int button = 0; button < 8; ++button) {
            if (button != 0) {
                out << ',';
            }
            out << jsonString(kButtonNames[button])
                << ':' << (buttonAt(pad.buttons, button) ? "true" : "false");
        }
        out << "}}";
    }
    out << "]}";
    return out.str();
}

}  // namespace fc
