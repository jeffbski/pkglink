#!/usr/bin/env bash

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
../bin/pkglink.js projects/foo1 | tee output.log
grep "pkgs: 21 saved: 0" output.log
../bin/pkglink.js projects/foo2 | tee output.log
grep "pkgs: 21 saved: 3" output.log

# combined dir runs
rimraf projects/foo3
cp -a projects/foo1 projects/foo3
../bin/pkglink.js -d projects/foo1 projects/foo3 | tee output.log
grep "# pkgs: 42 would save: 3" output.log
../bin/pkglink.js -g projects/foo1 projects/foo3 | tee output.log
grep "# pkgs: 42 would save: 3" output.log
../bin/pkglink.js projects/foo1 projects/foo3 | tee output.log
grep "pkgs: 42 saved: 3" output.log

cross-env BABEL_ENV=test mocha --compilers js:babel-register ../src/cli.compare-foo.mocha.man.js

rimraf projects/foo2
rimraf projects/foo3
rimraf output.log
