cmake_minimum_required(VERSION 3.20)

project(FCEmulator
    VERSION 0.1.0
    DESCRIPTION "NES / FC emulator for macOS - a computer science learning project"
    LANGUAGES CXX)

# ---------------------------------------------------------------------------
# C++ standard
# ---------------------------------------------------------------------------
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Default to a build type so tests are debuggable.
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Debug CACHE STRING "Build type" FORCE)
endif()

# Export compile_commands.json.
#
# This file is a "compilation database": for every .cpp it records the exact
# compiler invocation, including -std=c++20 and every -I path.
#
# Editors (VS Code / clangd / Emacs) read it instead of guessing. Without it,
# IntelliSense defaults to an older C++ standard and reports false errors such
# as:  namespace "std" has no member "unsigned_integral"
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Warnings: they are how the compiler teaches you about your own bugs.
add_compile_options(-Wall -Wextra -Wpedantic)

# ---------------------------------------------------------------------------
# Core library: pure C++, no UI dependency.
# ---------------------------------------------------------------------------
add_library(fc_core
    src/core/bit.cpp
    src/core/state.cpp
    src/core/cpu/cpu.cpp
    src/core/cpu/addressing.cpp
    src/core/nes/bus.cpp
    src/core/nes/ines.cpp
    src/core/nes/cartridge.cpp
    src/core/nes/ppu.cpp
    src/core/nes/machine.cpp
    src/core/nes/apu.cpp
    src/core/cpu/opcode.cpp
    src/core/cpu/disassembler.cpp
)
target_include_directories(fc_core PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

# ---------------------------------------------------------------------------
# The C interface. This is the only thing a frontend links against.
# ---------------------------------------------------------------------------
add_library(fc_ffi STATIC
    src/ffi/emulator_api.cpp
)
target_link_libraries(fc_ffi PUBLIC fc_core)
target_include_directories(fc_ffi PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

# The static libraries end up inside a shared object (the libretro core below),
# so they are compiled position independent. On arm64 this is already true of
# every instruction, but saying it keeps a future x86_64 build from having to
# discover it the hard way, at link time, in a message about relocations.
set_target_properties(fc_core fc_ffi PROPERTIES POSITION_INDEPENDENT_CODE ON)

# ---------------------------------------------------------------------------
# The WebAssembly build.
#
# A second target for the *same* sources. Nothing under src/core changed to
# make this work, and that is the point: the core has no file I/O, no threads
# and no exceptions, so it cross compiles untouched. Everything platform
# specific lives on the far side of src/ffi/emulator_api.h.
#
# The demos and the tests below are native only (they use <fstream> and
# <filesystem>), so the wasm build stops here.
# ---------------------------------------------------------------------------
if(EMSCRIPTEN)
    add_subdirectory(wasm)
    return()
endif()

# ---------------------------------------------------------------------------
# The libretro core.
#
# A shared object that exports the retro_* ABI, so RetroArch and every other
# libretro front end can load this emulator without knowing it exists yet. It
# adds no emulation of its own: src/libretro/fc_libretro.cpp translates the
# libretro calls into the same src/core the rest of the project uses.
#
# This is native only on purpose. A .dylib cannot be loaded from WebAssembly,
# so the wasm build of the core is a separate stage with a separate target
# (see docs/architecture/libretro-migration.md, stage L4).
#
#   macOS   -> fc_libretro.dylib      (PREFIX is empty on purpose)
#   Linux   -> fc_libretro.so
#   Windows -> fc_libretro.dll
# ---------------------------------------------------------------------------
option(FC_BUILD_LIBRETRO "Build the libretro core" ON)
if(FC_BUILD_LIBRETRO)
    add_library(fc_libretro MODULE
        src/libretro/fc_libretro.cpp
    )
    target_include_directories(fc_libretro PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/src
        ${CMAKE_CURRENT_SOURCE_DIR}/third_party/libretro
    )
    target_link_libraries(fc_libretro PRIVATE fc_core)

    # The version in the core's library_version, from the one place the project
    # declares it. A core whose name and version disagree with the build is a
    # report that cannot be trusted.
    target_compile_definitions(fc_libretro PRIVATE
        FC_LIBRETRO_VERSION="${PROJECT_VERSION}"
    )

    # libretro cores are named fc_libretro.dylib, not libfc_libretro.dylib:
    # every front end's core scanner expects the former. CMake gives a MODULE
    # the .so suffix on macOS, which no front end looks for, so the suffix is
    # set here too.
    set_target_properties(fc_libretro PROPERTIES
        PREFIX ""
        POSITION_INDEPENDENT_CODE ON
    )
    if(APPLE)
        set_target_properties(fc_libretro PROPERTIES SUFFIX ".dylib")
    endif()
endif()

# ---------------------------------------------------------------------------
# Teaching demos / command line tools.
# ---------------------------------------------------------------------------
add_executable(demo_bitwise tools/demo_bitwise.cpp)
target_link_libraries(demo_bitwise PRIVATE fc_core)

add_executable(demo_overflow tools/demo_overflow.cpp)
target_link_libraries(demo_overflow PRIVATE fc_core)

add_executable(demo_cpu tools/demo_cpu.cpp)
target_link_libraries(demo_cpu PRIVATE fc_core)

add_executable(demo_disasm tools/demo_disasm.cpp)
target_link_libraries(demo_disasm PRIVATE fc_core)

add_executable(demo_addressing tools/demo_addressing.cpp)
target_link_libraries(demo_addressing PRIVATE fc_core)

add_executable(demo_instructions tools/demo_instructions.cpp)
target_link_libraries(demo_instructions PRIVATE fc_core)

add_executable(demo_bus tools/demo_bus.cpp)
target_link_libraries(demo_bus PRIVATE fc_core)

add_executable(demo_cartridge tools/demo_cartridge.cpp)
target_link_libraries(demo_cartridge PRIVATE fc_core)

add_executable(demo_ppu tools/demo_ppu.cpp)
target_link_libraries(demo_ppu PRIVATE fc_core)

add_executable(demo_input tools/demo_input.cpp)
target_link_libraries(demo_input PRIVATE fc_core)

add_executable(demo_apu tools/demo_apu.cpp)
target_link_libraries(demo_apu PRIVATE fc_core)

# The native half of the headless parity tests: run a ROM through the C API
# with scripted input, and write PPMs. wasm/headless.mjs and the Electron self
# test do the same thing; this one shares no code with either, which is what
# makes the comparison meaningful.
add_executable(fc_headless tools/fc_headless.cpp)
target_link_libraries(fc_headless PRIVATE fc_ffi)

# The outside world's test ROMs. Links the core directly rather than the C
# interface, because it needs to step one instruction at a time and read the
# bus -- which is exactly what a debugger does, and exactly what the C
# interface is not for.
add_executable(fc_testrom tools/fc_testrom.cpp)
target_link_libraries(fc_testrom PRIVATE fc_core)

# The libretro acceptance probe. Unlike every other tool here it does not link
# the emulator: it dlopen()s fc_libretro.dylib the way a front end does, and
# drives it through a stand-in front end. That is what makes it a test of the
# loaded core rather than of the functions in this build.
add_executable(fc_libretro_probe tools/fc_libretro_probe.cpp)
target_include_directories(fc_libretro_probe PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/third_party/libretro
    ${CMAKE_CURRENT_SOURCE_DIR}/src/libretro
)
target_link_libraries(fc_libretro_probe PRIVATE ${CMAKE_DL_LIBS})

# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
option(FC_BUILD_TESTS "Build the unit tests" ON)
if(FC_BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()
