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
    test_libretro.cpp
    test_cheat_codes.cpp
    # The libretro adapter is compiled in here as well as into the shared
    # object, so the ABI is covered by the ordinary test run rather than only
    # by the probe. One small file, two builds, and the same source either way.
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/libretro/fc_libretro.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/libretro/cheat_codes.cpp
)

target_include_directories(fc_tests PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/../third_party/libretro
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/libretro
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
    FC_LIBRETRO_VERSION="${PROJECT_VERSION}"
)

include(GoogleTest)
gtest_discover_tests(fc_tests)
