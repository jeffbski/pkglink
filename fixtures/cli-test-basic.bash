#!/usr/bin/env bash

PKGLINK_EXEC="$1"

set -e
set -x

# cwd should be here in fixtures

# make sure foo1 is npm installed
pushd projects/foo1
npm install
popd

# single dir runs
rimraf projects/foo2
cp -a projects/foo1 projects/foo2
${PKGLINK_EXEC} projects/foo1 | tee output.log
grep "pkgs: 21 saved: 0" output.log
${PKGLINK_EXEC} projects/foo2 | tee output.log
grep "pkgs: 21 saved: 3" output.log

# combined multi-dir runs
rimraf projects/foo3
cp -a projects/foo1 projects/foo3
${PKGLINK_EXEC} -d projects/foo1 projects/foo3 | tee output.log
grep "# pkgs: 42 would save: 3" output.log
${PKGLINK_EXEC} -g projects/foo1 projects/foo3 | tee output.log
grep "# pkgs: 42 would save: 3" output.log
${PKGLINK_EXEC} projects/foo1 projects/foo3 | tee output.log
grep "pkgs: 42 saved: 3" output.log

# combined projects run
rimraf projects/foo4
cp -a projects/foo1 projects/foo4
${PKGLINK_EXEC} -d projects | tee output.log
grep "# pkgs: 84 would save: 3" output.log
${PKGLINK_EXEC} -g projects | tee output.log
grep "# pkgs: 84 would save: 3" output.log
${PKGLINK_EXEC} projects | tee output.log
grep "pkgs: 84 saved: 3" output.log

cross-env BABEL_ENV=test mocha --compilers js:babel-register ../src/cli.compare-foo.mocha.man.js

rimraf projects/foo2
rimraf projects/foo3
rimraf projects/foo4
rimraf output.log
