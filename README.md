# pkglink

Space saving Node.js package hard linker.

pkglink locates common JavaScript/Node.js packages from your node_modules directories and hard links the package files so they share disk space.

[![Build Status](https://secure.travis-ci.org/jeffbski/pkglink.png?branch=master)](http://travis-ci.org/jeffbski/pkglink) [![Known Vulnerabilities](https://snyk.io/test/github/jeffbski/pkglink/cb67b52c10073cbd5a7e6cc6798931db779adb97/badge.svg)](https://snyk.io/test/github/jeffbski/pkglink/cb67b52c10073cbd5a7e6cc6798931db779adb97)

<img src="https://cloud.githubusercontent.com/assets/5689/19868149/ccf7ded8-9f74-11e6-808e-247d24e68d27.gif" width="640" height="360" alt="demo" />

## Why?

As an instructor, I create lots of JavaScript and Node.js projects and many of them use the same packages. **However due to the way packages are installed they all take up their own disk space.** It would be nice to have a way for the installations of the same package to **share disk space**.

Modern operating systems and disk formats support the concept of **hard links** which is a way to have one copy of a file on disk that can be used from multiple paths. Since packages are generally read-only once they are installed, it would save much disk space if we could hard link their files.

pkglink is a command line tool that searches directory tree that you specify for packages in your node_modules directories. When it finds matching packages of the same name and version that could share space, it hard links the files. As a safety precaution it checks many file attributes before considering them for linking ([see full details later in this doc](#what-files-will-it-link-in-the-packages)).

pkglink keeps track of packages it has seen on previous scans so when you run on new directories in the future, it can quickly know where to look for previous package matches. It double checks the previous packages are still the proper version, inode, and modified time before linking, but this prevents performing full tree scans any time you add a new project. Simply run pkglink once on your project tree and then again on new projects as you create them.

pkglink has been tested on Ubuntu, Mac OS X, and Windows. Hard links are supported on most modern disk formats with the exception of FAT and ReFS.

## How much savings?

It all depends on how many matching packages you have on your system, but you will probably be surprised.

After running pkglink on my project directories, **it found 128K packages and saved over 20GB of disk space**.

## Assumptions for use

The main assumption that enables hard linking is that you are not manually modifying your packages after install from the registry. This means that installed packages of the same name and version should generally be the same. Additional checks at the file level are used to verify matches ([see filter criteria later in this doc](#what-files-will-it-link-in-the-packages)) before selecting them for linking.

Before running any tool that can modify your file system it is always a good idea to have a current backup and sync code with your repositories.

Hard linking will not work on FAT and ReFS file systems. Hard links can only be made between files on the same device (drive). pkglink has been tested on Mac OS X (hpfs), Ubuntu (ext4), and Windows (NTFS).

If you had to recover from an unforeseen defect in pkglink, the recovery process is to simply delete your project's node_modules directory and perform npm install again.


## Installation

```bash
npm install -g pkglink
```

## Quick start

### To find and hard link matching packages

To hard link packages just run pkglink with one or more directory trees that you wish it to scan and link.

```bash
pkglink DIR1 DIR2 ...
```

You will get output similar to this:

```
jeffbski-laptop:~$ pkglink ~/projects ~/working

pkgs: 128,383 saved: 5.11GB
```

The run above indicated that pkglink found 128K packages and after linking it saved over 5GB of disk space. (Actual savings was higher since I had run pkglink on a portion of the tree previously)

### Dryrun - just output a list of matching packages

If you wish to see what packages pkglink would link you can use the `--dryrun` or `-d` option. pkglink will output matching packages that it would normally link but it will NOT perform any linking.

```bash
pkglink -d DIR1 DIR2 ...
```

The `--dryrun` output looks like:

```
jeffbski-laptop:~$ pkglink -d ~/working/expect-test

tmatch-2.0.1
  /Users/jeff/projects/pkglink/fixtures/projects/foo1/node_modules/tmatch
  /Users/jeff/working/expect-test/node_modules/tmatch

object.entries-1.0.3
  /Users/jeff/projects/pkglink/fixtures/projects/foo1/node_modules/object.entries
  /Users/jeff/working/expect-test/node_modules/object.entries

object-keys-1.0.11
  /Users/jeff/projects/pkglink/fixtures/projects/foo1/node_modules/object-keys
  /Users/jeff/working/expect-test/node_modules/object-keys

# pkgs: 21 would save: 3.88MB
```

### Generate link commands only

If you want to see exactly what it would be linking down to the file level, you can use the `--gen-ln-cmds` or `-g` option and it will output the equivalent bash commands for the hard links that it would normally create. It will not peform the linking. You can view this for correctness or even save it to a file and excute it with bash besides just running pkglink again wihout the `-g` option.

```bash
pkglink -g DIR1 DIR2 ...
```

The `--gen-ln-cmds` output looks like

```
jeffbski-laptop:~$ pkglink -g ~/working/expect-test

ln -f "/Users/jeff/projects/pkglink/fixtures/projects/foo1/node_modules/define-properties/index.js" "/Users/jeff/working/expect-test/node_modules/define-properties/index.js"
ln -f "/Users/jeff/projects/pkglink/fixtures/projects/foo1/node_modules/expect/CHANGES.md" "/Users/jeff/working/expect-test/node_modules/expect/CHANGES.md"
ln -f "/Users/jeff/projects/pkglink/fixtures/projects/foo1/node_modules/expect/LICENSE.md" "/Users/jeff/working/expect-test/node_modules/expect/LICENSE.md"
ln -f "/Users/jeff/projects/pkglink/fixtures/projects/foo1/node_modules/es-abstract/Makefile" "/Users/jeff/working/expect-test/node_modules/es-abstract/Makefile"
# pkgs: 21 would save: 3.88MB
```

## Full Usage

```
Usage: pkglink {OPTIONS} [dir] [dirN]

Description:

     pkglink - Space saving Node.js package hard linker

     pkglink recursively searches directories for Node.js packages
     installed in node_modules directories. It uses the package name
     and version to match up possible packages to share. Once it finds
     similar packages, pkglink walks through the package directory tree
     checking for files that can be linked. If each file's modified
     datetime and size match, it will create a hard link for that file
     to save disk space. (On win32, mtimes are inconsistent and ignored)

     It keeps track of modules linked in ~/.pkglink_refs to quickly
     locate similar modules on future runs. The refs are always
     double checked before being considered for linking. This makes
     it convenient to perform future pkglink runs on new directories
     without having to reprocess the old.

Standard Options:

 -c, --config CONFIG_PATH

  This option overrides the config file path, default ~/.pkglink

 -d, --dryrun

  Instead of performing the linking, just display the modules that
  would be linked and the amount of disk space that would be saved.

 -g, --gen-ln-cmds

  Instead of performing the linking, just generate link commands
  that the system would perform and output

 -h, --help

  Show this message

 -m, --memory MEMORY_MB

  Run with increased or decreased memory specified in MB, overrides
  environment variable PKGLINK_NODE_OPTIONS and config.memory
  The default memory used is 2560.

 -p, --prune

  Prune the refs file by checking all of the refs clearing out any
  that have changed

 -r, --refs-file REFS_FILE_PATH

  Specify where to load and store the link refs file which is used to
  quickly locate previously linked modules. Default ~/pkglink_refs.json

 -t, --tree-depth N

  Maximum depth to search the directories specified for packages
  Default depth: 0 (unlimited)

 -v, --verbose

  Output additional information helpful for debugging
```

If your machine has less than 2.5GB of memory you can use `pkglink_low` instead of `pkglink` and it will run with the normal 1.5GB memory default.

## Config

The default config file path is `~/.pkglink` unless you override it with the `--config` command line option. If this file exists it should be a JSON file with an object having any of the following properties.

 - `refsFile` - location of the JSON file used to track the last 5 references to each package it finds, default: `~/.pkglink_refs`. This can also be overridden with the `--refs-file` command line argument.

 - `concurrentOps` - the number of concurrent operations allowed for IO operations, default: 4
 - `consoleWidth` - the number of columns in your console, default: 70
 - `ignoreModTime` - ignore the modification time of the files, default is true on Windows, otherwise false
 - `memory` - adjust the memory used in MB, default: 2560 (2.5GB). Can also be overridden by setting environment variable PKGLINK_NODE_OPTIONS=--max-old-space-size=1234 or by using the command line argument `--memory`.
 - `minFileSize` - the minimum size file to consider for linking in bytes, default: 0
 - `refSize` - number of package refs to keep in the refsFile which is used to find matching packages on successive runs, default: 5
 - `tree-depth` - the maximum depth to search the directories for packages, default: 0 (unlimited). Can also be overridden with `--tree-depth` command line option.

## How do I know it is working?

Well if you check your disk space before and after a run it should be at least as much savings as pkglink indicates during a run. pkglink indicates the file size saved, but the actual savings can be greater due to the block size of the disk.

On systems with bash, you can also use `ls -ali node_modules/XYZ` to see the number of hard links a particular file has (which is the number of times it is shared) and the actual inode values.

When using the `-i` option with `ls` the first column is the inode of the file, so you can verify one directories' files with another. Also the 3rd column is the number of hard links, so you can see that CHANGELOG.md, LICENSE, README.md, and index.js all have 17 hard links.

```bash
jeffbski-laptop:~/working/expect-test$ ls -ali node_modules/define-properties/
total 80
89543426 drwxr-xr-x  13 jeff  staff   442 Oct 22 04:02 .
89543425 drwxr-xr-x  24 jeff  staff   816 Oct 22 03:58 ..
89543473 -rw-r--r--   1 jeff  staff   276 Oct 14  2015 .editorconfig
89543474 -rw-r--r--   1 jeff  staff   156 Oct 14  2015 .eslintrc
89543475 -rw-r--r--   1 jeff  staff  3062 Oct 14  2015 .jscs.json
89543476 -rw-r--r--   1 jeff  staff     8 Oct 14  2015 .npmignore
89543477 -rw-r--r--   1 jeff  staff  1182 Oct 14  2015 .travis.yml
89212049 -rw-r--r--  17 jeff  staff   972 Oct 14  2015 CHANGELOG.md
89212004 -rw-r--r--  17 jeff  staff  1080 Oct 14  2015 LICENSE
89211984 -rw-r--r--  17 jeff  staff  2725 Oct 14  2015 README.md
89212027 -rw-r--r--  17 jeff  staff  1560 Oct 14  2015 index.js
89543482 -rw-r--r--   1 jeff  staff  1593 Oct 14  2015 package.json
89543447 drwxr-xr-x   3 jeff  staff   102 Oct 22 04:02 test
```

## What files will it link in the packages

pkglink looks for packages in the node_modules directories of the directory trees that you specify as args on the command line.

To be considered for linking the following criteria are checked:

 - package name and version from package.json must match
 - package.json is excluded from linking since npm often modifies it on install
 - files are on the same device (drive) - hard links only work on same device
 - files are not already the same inode (not already hard linked)
 - file size is the same
 - file modified time is the same (except on Windows which doesn't maintain the original modified times during npm installs)
 - file size is >= to config.minFileSize (defaults to 0 to include all)
 - directories starting with a `.` and all their descendents are ignored

## FAQ

### Q. Can I run this for a single project?

Yes, pkglink is designed so that you can run it for individual projects or for a whole directory tree. It keeps track of packages it has already seen on previous runs (in its refs file) so it can perform links with those as well as any duplication in your project.

### Q. Once I use this do I need to do anything special when deleting or updating projects?

No, since pkglink works by using hard links, your operating system will handle things appropriately under the covers. The OS updates the link count when packages are deleted from a particular path. If you update or reinstall then your packages will simply replace those that were there. You could run pkglink on the project again to hard link the new files.

Also while pkglink keeps a list of packages it has found in its refs file (~/.pkglink_refs), it always double checks packages before using them for linking (and it updates the refs file). You may also run pkglink with the `--prune` option to check all the refs.

### Q. Can I interrupt pkglink during its run?

Yes, type Control-c once and pkglink will cancel its processing and shutdown. Please allow time for it to gracefully shutdown.

### Q. What does the output mean?

```
jeffbski-laptop:~$ pkglink ~/projects ~/working

pkgs: 128,383 saved: 5.11GB
```

For this pkglink found 128K packages and after performing linking it saved over 5GB of space. pkglink reports the total of the file size saved, but the actual savings on disk is likely larger due to drive block sizes. Using `df -H` before and after the run, the actual size saved was around 11GB.

Since I had already run pkglink on portions of this tree, this was only the additional savings gained. I had already linked another 8GB previously so my total link savings was closer to 20GB.

If you were to run pkglink again immediately after this previous run it will come back with the same pkg count but the savings reported this time would be 0 since everything had been linked previously.

### Q. What do I do if I get an out of memory error?

If you run pkglink on a really large directory tree, you might get an out of memory error during the run.

The error might look something like:

```
FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory
```

You can either run pkglink on smaller portions of the tree at a time or you can allow pkglink to use more memory for its run. You can do this by using the `--memory` or `-m` option or changing the `memory` config option in the ~/.pgklink JSON file.

By default pkglink runs with 2.5GB of memory, so to increase it to 4GB, you could use the following command:

```bash
pkglink -m 4096 DIR1 DIR2 ...
```

If you don't even have 2.5GB of memory, you can use the low memory version of pkglink, `pkglink_low DIR1 DIR2 ...` and it will just run with the node.js defaults. Note that you may need to run pkglink_low on smaller portions of the directory tree at a time.


## Recovering from an unforeseen problem

If you need to recover from a problem the standard way is to simply delete your project's `node_modules` directory and run `npm install` again.

If pkglink exits early, failing to give you the summary output or if you get an out of memory error, see the FAQ above about [handling out of memory errors](#q-what-do-i-do-if-i-get-an-out-of-memory-error). You can run pkglink on smaller directory trees at a time or increase the memory available to it.

## License

MIT license

## Credits

This project was born out of discussions between @kevinold and @jeffbski at Strange Loop 2016.

[CodeWinds Training](https://codewinds.com) sponsored the development of this project. CodeWinds offers live in-person or webinar developer training in React, Redux, RxJS, or Node.js.
