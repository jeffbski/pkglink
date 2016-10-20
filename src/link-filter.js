
/*
   Filter applied to files being considered for linking
   @returns true for files to perform a hard link on
 */
export default function linkFilter(config, dstPackInode, x) {
  // filter out missing targets
  return ((x.dstEI) &&
   // take only non-package.json files
   (x.dstEI.stat.ino !== dstPackInode) &&
   // make sure not same inode as master
   (x.srcEI.stat.ino !== x.dstEI.stat.ino) &&
   // same device
   (x.srcEI.stat.dev === x.dstEI.stat.dev) &&
   // same size
   (x.srcEI.stat.size === x.dstEI.stat.size) &&
   // same modified datetime
   (x.srcEI.stat.mtime.getTime() ===
     x.dstEI.stat.mtime.getTime()) &&
   // big enough to care about
   (x.dstEI.stat.size >= config.minFileSize)
  );
}
