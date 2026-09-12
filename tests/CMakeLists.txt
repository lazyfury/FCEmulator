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
)

target_link_libraries(fc_tests PRIVATE
    fc_core
    GTest::gtest_main
)

include(GoogleTest)
gtest_discover_tests(fc_tests)
