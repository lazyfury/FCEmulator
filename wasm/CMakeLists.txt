# ---------------------------------------------------------------------------
# The WebAssembly module.
#
# Reached only via emcmake, from the block in the top level CMakeLists.txt.
#
#   source third_party/emsdk/emsdk_env.sh
#   emcmake cmake -S . -B build-wasm -G Ninja -DCMAKE_BUILD_TYPE=Release
#   cmake --build build-wasm
#   # -> wasm/dist/fc_core.mjs + wasm/dist/fc_core.wasm
#
# or just:  ./wasm/build.sh
#
# The whole module is one .wasm plus a thin ES module loader. It is loaded
# both by the Electron renderer and by `node wasm/headless.mjs`, which is the
# point of doing it this way: the thing we regression test is the thing we
# ship.
# ---------------------------------------------------------------------------

add_executable(fc_wasm
    ${CMAKE_CURRENT_SOURCE_DIR}/glue.cpp
)

target_link_libraries(fc_wasm PRIVATE fc_ffi)

# The emulator has no UI, so it has no business pulling in a DOM, a filesystem
# or a wall clock. Emscripten will happily add all three; say no.
#
#   FILESYSTEM=0    we hand ROM bytes in through memory, so there is nothing
#                   to mount. Saves a surprising amount of generated code.
#   ALLOW_MEMORY_GROWTH=0
#                   a fixed heap. Growth detaches every cached typed array
#                   view into the heap, which is the classic wasm emulator
#                   bug: the picture freezes or tears a frame later. A fixed
#                   64MB removes the whole class of problem, and the largest
#                   cartridge we support is 2MB.
#   INITIAL_MEMORY  64MB: framebuffer 240KB, ROM up to a few MB, CHR RAM,
#                   2KB of console RAM, and the APU's sample queue.
#
# `--no-entry` because there is no main(). The module is a bag of functions
# that the front end calls in whatever order it likes.
set(FC_WASM_EXPORTS
    _fc_create
    _fc_destroy
    _fc_load_rom
    _fc_last_error
    _fc_rom_summary
    _fc_reset
    _fc_run_frame
    _fc_is_halted
    _fc_frame_count
    _fc_framebuffer
    _fc_pixel
    _fc_sample_rate
    _fc_take_samples
    _fc_samples_pending
    _fc_clear_samples
    _fc_set_button
    _fc_release_all_buttons
    _fc_total_cycles
    _fc_cpu_pc
    _fc_save_state
    _fc_save_state_into
    _fc_state_size
    _fc_load_state
    _fc_free_state
    _fc_mapper_saves_state
    _fc_wasm_abi
    _fc_wasm_screen_width
    _fc_wasm_screen_height
    _fc_wasm_sample_rate
    _malloc
    _free
)

# The heap views. src/ffi/emulator_api.h hands back bare pointers -- the
# framebuffer at 0x00RRGGBB per pixel, and APU samples as float -- and a
# pointer is only useful on the JavaScript side if we can turn it back into a
# typed array. That is what HEAPU8 and HEAPF32 are.
#
# They are not exposed by default any more, so ask for them by name. UTF8ToString
# is how a `const char*` becomes a JavaScript string.
set(FC_WASM_RUNTIME_METHODS
    HEAPU8
    HEAPF32
    UTF8ToString
    stringToUTF8
    lengthBytesUTF8
)

string(REPLACE ";" "," FC_WASM_EXPORTS_CSV "${FC_WASM_EXPORTS}")
string(REPLACE ";" "," FC_WASM_RUNTIME_CSV "${FC_WASM_RUNTIME_METHODS}")

target_link_options(fc_wasm PRIVATE
    --no-entry
    -sMODULARIZE=1
    # EXPORT_ES6 means `import createFcCore from './fc_core.mjs'` works in both
    # Node and a browser. Node needs .mjs (or a package.json with
    # "type":"module"), which is why the output is named that way below.
    -sEXPORT_ES6=1
    -sEXPORT_NAME=createFcCore
    -sFILESYSTEM=0
    -sALLOW_MEMORY_GROWTH=0
    -sINITIAL_MEMORY=67108864
    -sSTACK_SIZE=1048576
    # Do NOT set -sEXPORT_KEEPALIVE=0 here. It reads like a harmless "we are
    # not using EMSCRIPTEN_KEEPALIVE" switch, but it also stops Emscripten
    # from attaching anything in EXPORTED_FUNCTIONS to the module object: the
    # .wasm still exports them, the glue still copies them into local
    # variables, and `Module._fc_create` is silently undefined.
    "-sEXPORTED_FUNCTIONS=[${FC_WASM_EXPORTS_CSV}]"
    "-sEXPORTED_RUNTIME_METHODS=[${FC_WASM_RUNTIME_CSV}]"
)

# Emit the module straight into wasm/dist, next to the JavaScript that loads
# it, so nothing has to copy files around afterwards.
set_target_properties(fc_wasm PROPERTIES
    OUTPUT_NAME "fc_core"
    SUFFIX ".mjs"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/dist"
)
