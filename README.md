# pkglink

Space saving Node.js package hard linker.

pkglink locates common packages and hard links the JavaScript and Node.js package files in your node_modules directories so they share disk space.

[![Build Status](https://secure.travis-ci.org/jeffbski/pkglink.png?branch=master)](http://travis-ci.org/jeffbski/pkglink)

## Why?

As an instructor, I create lots of JavaScript and Node.js projects and many of them use the same packages. **However due to the way packages are installed they all take up their own disk space.** It would be nice to have a way for the installations of the same package to **share disk space**.

Modern operating systems and disk formats support the concept of **hard links** which is a way to have one copy of a file on disk that can be used from multiple paths. Since packages are generally read-only once they are installed, it would save much disk space if we could hard link their files.

pkglink is a command lind tool that searches directory tree that you specify for packages in your node_modules directories. When it finds matching packages of the same name and version that could share space, it hard links the files. As a safety precaution it checks many file attributes before considering them for linking (see full details later in this doc).

pkglink keeps track of packages it has seen on previous scans so when you run on new directories in the future, it can quickly know where to look for previous package matches. It double checks the previous packages are still the proper version, inode, and modified time before linking, but this prevents performing full tree scans any time you add a new project. Simply run pkglink once on your project tree and then again on new projects as you create them.

pkglink has been tested on Ubuntu, Mac OS X, and Windows. Hard links are supported on most modern disk formats with the exception of FAT and ReFS.

## Assumptions for use

The main assumption that enables hard linking is that you are not manually modifying your packages after install from the registry. This means that installed packages of the same name and version should generally be the same. Additional checks at the file level are used to verify matches (see filter criteria later in this doc) before selecting them for linking.

Before running any tool that can modify your file system it is always a good idea to have a current backup and sync code with your repositories.

Hard linking will not work on FAT and ReFS file systems. Hard links can only be made between files on the same device (drive). pkglink has been tested on Mac OS X (hpfs), Ubuntu (ext4), and Windows (NTFS).

If you had to recover from an unforeseen defect in pkglink, the recovery process is to simply delete your project's node_modules directory and perform npm install again.


## Installation

```bash
npm install -g pkglink
```

## Quick start

To hard link packages just run pkglink with one or more directory trees that you wish it to scan and link.

```bash
pkglink DIR1 DIR2 ...
```

If you wish to see what packages it finds to link you can use the `--dry-run` or `-d` option. pkglink will output matching packages that it would normally link but it will NOT perform any linking.

```bash
pkglink --dry-run DIR1 DIR2 ...
```

If you want to see exactly what it would be linking down to the file level, you can use the `--gen-ln-cmds` or `-g` option and it will output the equivalent bash commands for the hard links that it would normally create. It will not peform the linking. You can view this for correctness or even save it to a file and excute it with bash besides just running it again wihout the option.

```bash
pkglink --gen-ln-cmds DIR1 DIR2 ...
```


## Usage

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

Well if you check your disk space before and after a run it should be at least as much savings as pkglink indicates during a run. pkglink indicates the file size, but the actual savings can be greater due to the block of the disk.

On systems with a working bash, you can also use `ls -ali node_modules/XYZ` to see the number of hard links a file has (meaning the number of times it is shared) and the action inode values of files.

When using the `-i` option with `ls` the first column is the actual inode of the file, so you can verify one directories' files with another. Also the 3rd column is the number of hard links, so you can see that CHANGELOG.md, LICENSE, README.md, and index.js all have 17 hard links.

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

It looks for packages in the node_modules directories of the directory trees that you specify on the command line.

To be considered for linking the following criteria are checked:

 - package name and version from package.json must match
 - package.json is excluded from linking since npm modifies it on install
 - files are on the same device (drive) - hard links only work on same device
 - files are not already the same inode (not already hard linked)
 - file size is the same
 - file modified time is the same (except on Windows which doesn't maintain the original modified times during install)
 - file size is >= to config.minFileSize (defaults to 0)
 - directories starting with a `.` and all their descendents are ignored

## FAQ

Q. Once I use this do I need to do anything special when deleting or updating projects?

No, since pkglink works by using hard links, your operating system will handle things appropriately under the covers. The OS updates the link count when packages are deleted from a particular path. If you update or reinstall then your packages will simply replace those that were there. You could run pkglink on the project again to hard link the new files.

Also while pkglink keeps a list of packages it has found in its refs file (~/.pkglink_refs), it always double checks packages before using them for linking (and it updates the refs file). You may also run pkglink with the `--prune` option to check all the refs.

Q. Can I interrupt pkglink during its run?

Yes, type Control-c once and pkglink will cancel its processing and shutdown. Please allow time for it to gracefully shutdown.

## Recovering from an unforeseen problem

If you need to recover from a problem the standard way is to simply delete your project's `node_modules` directory and run `npm install` again.

If you get an out of memory error while running you can increase the memory using a command line option, environment variable, or the config file. If your operating system doesn't have 2.5GB memory to launch pkglink you can use the low memory version, run `pkglink_low` instead and it will run with reduced memory.

## License

MIT license

## Credits

This project was born out of discussions between @kevinold and @jeffbski at Strange Loop 2016.

[CodeWinds Training](https://codewinds.com) sponsored the development of this project. For live in-person or webinar developer training in React, Redux, RxJS, or Node.js contact Jeff at CodeWinds.
