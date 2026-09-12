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
    src/core/cpu/cpu.cpp
    src/core/cpu/addressing.cpp
    src/core/cpu/opcode.cpp
    src/core/cpu/disassembler.cpp
)
target_include_directories(fc_core PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

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

# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
option(FC_BUILD_TESTS "Build the unit tests" ON)
if(FC_BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()
