#!/usr/bin/env bash

PKGLINK_EXEC="$1"

set -e
set -x

unamestr=$(uname)

# windows is not piping child procs so skip child-proc test
if [[ "$PKGLINK_EXEC" == "node ../bin/pkglink.js" && $unamestr =~ _NT ]] ; then
    echo "skipping child proc test on windows due to piping issue"
    exit 0
fi

# cwd should be here in fixtures
rimraf REFS.json
rimraf projects/foo2
rimraf projects/foo3
rimraf projects/bar1
rimraf projects/cat1

# single dir runs
rimraf projects/foo2
cp -a projects/foo1 projects/foo2
${PKGLINK_EXEC} -vr REFS.json projects/foo1 | tee output.log
grep "pkgs: 21 saved: 0" output.log
${PKGLINK_EXEC} -vr REFS.json projects/foo2 | tee output.log
grep "pkgs: 21 saved: 3.88MB" output.log
grep "define-properties" REFS.json

# combined multi-dir runs
rimraf projects/foo3
cp -a projects/foo1 projects/foo3
${PKGLINK_EXEC} -vr REFS.json -d projects/foo1 projects/foo3 | tee output.log
grep "# pkgs: 42 would save: 3.88MB" output.log
${PKGLINK_EXEC} -vr REFS.json -g projects/foo1 projects/foo3 | tee output.log
grep "# pkgs: 42 would save: 3.88MB" output.log
${PKGLINK_EXEC} -vr REFS.json projects/foo1 projects/foo3 | tee output.log
grep "pkgs: 42 saved: 3.88MB" output.log

# combined projects run picks up projects/bar1 (expect ver different)
rimraf projects/bar1
cp -a projects/foo1 projects/bar1
cd projects/bar1
npm install -S expect@1.20.1 --no-shrinkwrap
cd -
${PKGLINK_EXEC} -vr REFS.json -d projects | tee output.log
grep "# pkgs: 84 would save: 3.68MB" output.log
${PKGLINK_EXEC} -vr REFS.json -g projects | tee output.log
grep "# pkgs: 84 would save: 3.68MB" output.log
${PKGLINK_EXEC} -vr REFS.json projects | tee output.log
grep "pkgs: 84 saved: 3.68MB" output.log

# different modified time excluded
rimraf projects/cat1
cp -a projects/foo1 projects/cat1
if [[ "$unamestr" =~ _NT ]] ; then  # windows can't do modtime
  ${PKGLINK_EXEC} -vr REFS.json projects | tee output.log
  grep "pkgs: 105 saved: 3.88MB" output.log
else # non-windows, test modtime excluded
  touch projects/cat1/node_modules/expect/lib/Expectation.js
  ${PKGLINK_EXEC} -vr REFS.json -d projects | tee output.log
  grep "# pkgs: 105 would save: 3.87MB" output.log
  ${PKGLINK_EXEC} -vr REFS.json -g projects | tee output.log
  grep "# pkgs: 105 would save: 3.87MB" output.log
  ${PKGLINK_EXEC} -vr REFS.json projects | tee output.log
  grep "pkgs: 105 saved: 3.87MB" output.log
fi

cross-env BABEL_ENV=test mocha --compilers js:babel-register ../src/cli.compare-foo.mocha.man.js

# REFS should contain foo2, delete foo2, prune, REFS no foo2
grep "foo2" REFS.json
rimraf projects/foo2/node_modules
${PKGLINK_EXEC} -vpr REFS.json -p | tee output.log
grep "updated REFS.json" output.log
grep -L "foo2" REFS.json | grep REFS.json

rimraf projects/foo2
rimraf projects/foo3
rimraf projects/bar1
rimraf projects/cat1
rimraf REFS.json
rimraf output.log
