#!/usr/bin/env bash

PKGLINK_EXEC="$1"

set -e
set -x

# cwd should be here in fixtures
rimraf REFS.json

# single dir runs
rimraf projects/foo2
cp -a projects/foo1 projects/foo2
${PKGLINK_EXEC} -vr REFS.json projects/foo1 | tee output.log
grep "pkgs: 21 saved: 0" output.log
${PKGLINK_EXEC} -vr REFS.json projects/foo2 | tee output.log
grep "pkgs: 21 saved: 3" output.log
grep "define-properties" REFS.json

# combined multi-dir runs
rimraf projects/foo3
cp -a projects/foo1 projects/foo3
${PKGLINK_EXEC} -vr REFS.json -d projects/foo1 projects/foo3 | tee output.log
grep "# pkgs: 42 would save: 3" output.log
${PKGLINK_EXEC} -vr REFS.json -g projects/foo1 projects/foo3 | tee output.log
grep "# pkgs: 42 would save: 3" output.log
${PKGLINK_EXEC} -vr REFS.json projects/foo1 projects/foo3 | tee output.log
grep "pkgs: 42 saved: 3" output.log

# combined projects run
rimraf projects/foo4
cp -a projects/foo1 projects/foo4
${PKGLINK_EXEC} -vr REFS.json -d projects | tee output.log
grep "# pkgs: 84 would save: 3" output.log
${PKGLINK_EXEC} -vr REFS.json -g projects | tee output.log
grep "# pkgs: 84 would save: 3" output.log
${PKGLINK_EXEC} -vr REFS.json projects | tee output.log
grep "pkgs: 84 saved: 3" output.log

cross-env BABEL_ENV=test mocha --compilers js:babel-register ../src/cli.compare-foo.mocha.man.js

# REFS should contain foo2, delete foo2, prune, REFS no foo2
grep "projects/foo2/node_modules" REFS.json
rimraf projects/foo2/node_modules
${PKGLINK_EXEC} -vpr REFS.json -p | tee output.log
grep "updated REFS.json" output.log
# TODO add test to check that foo2 no longer in the REFS.json

rimraf projects/foo2
rimraf projects/foo3
rimraf projects/foo4
rimraf REFS.json
rimraf output.log
