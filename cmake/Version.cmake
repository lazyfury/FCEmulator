# ---------------------------------------------------------------------------
# The one place the project version lives.
#
# This is a monorepo: `packages/fc-core` and `packages/fc-libretro` are separate
# CMake projects, each with its own `project()` call and each buildable on its
# own. A version number written in two places is a version number that will
# eventually disagree with itself, and a front end that reports
# `library_version` 0.1.0 while the app it came with says 0.2.0 produces a bug
# report nobody can act on. So the number lives here, once, and both the root
# project and every package include this file before their `project()` call.
#
# `FC_PROJECT_VERSION` is a normal (not cache) variable: a package built on its
# own gets the default below, and the monorepo root can override it on the
# command line with -DFC_PROJECT_VERSION=... if a release ever needs to.
# ---------------------------------------------------------------------------

if(NOT DEFINED FC_PROJECT_VERSION)
    set(FC_PROJECT_VERSION "0.1.0")
endif()
