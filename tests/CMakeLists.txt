# ---------------------------------------------------------------------------
# Unit tests
#
# We prefer a system-installed GoogleTest (e.g. `brew install googletest`).
# If it is not found we fall back to downloading it with FetchContent.
# ---------------------------------------------------------------------------

find_package(GTest QUIET)

if(NOT GTest_FOUND)
    message(STATUS "System GoogleTest not found, fetching from GitHub...")
    include(FetchContent)
    FetchContent_Declare(
        googletest
        GIT_REPOSITORY https://github.com/google/googletest.git
        GIT_TAG        v1.15.2
    )
    set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
    FetchContent_MakeAvailable(googletest)
endif()

add_executable(fc_tests
    test_bit.cpp
    test_alu.cpp
    test_registers.cpp
    test_cpu.cpp
    test_disassembler.cpp
    test_addressing.cpp
    test_instruction_set.cpp
    test_cycles.cpp
    test_nes_bus.cpp
    test_cartridge.cpp
    test_cheats.cpp
    test_real_rom.cpp
    test_ppu.cpp
    test_controller.cpp
    test_apu.cpp
    test_state.cpp
    test_ffi.cpp
)

target_link_libraries(fc_tests PRIVATE
    fc_ffi
    fc_core
    GTest::gtest_main
)

# Where the real-ROM tests look for a .nes file. Nothing is committed there;
# the tests skip themselves when the folder is empty.
target_compile_definitions(fc_tests PRIVATE
    FC_TEST_DATA_DIR="${CMAKE_CURRENT_SOURCE_DIR}/data"
)

include(GoogleTest)
gtest_discover_tests(fc_tests)
