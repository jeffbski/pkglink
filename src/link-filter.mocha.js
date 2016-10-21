/* eslint-disable import/no-extraneous-dependencies */
import expect from 'expect';
import R from 'ramda';
import linkFilter from './link-filter';

const config = {
  minFileSize: 0
};

const dstPackInode = 1; // package.json inode

const masterEI = {
  stat: {
    ino: 100,
    dev: 'abc',
    size: 123,
    mtime: new Date()
  }
};

const match1 = {
  stat: {
    ino: 101,
    dev: 'abc',
    size: 123,
    mtime: masterEI.stat.mtime
  }
};

const linked1 = {
  stat: {
    ...masterEI.stat
  }
};

describe('link-filter', () => {
  describe('missing targets', () => {
    it('should exclude', () => {
      const x = { srcEI: masterEI };
      expect(
        linkFilter(config, dstPackInode, x)
      ).toNotExist();
    });
  });

  describe('non-package.json', () => {
    it('should exclude', () => {
      const x = R.set(
        R.lensPath(['dstEI', 'stat', 'ino']),
        dstPackInode,
        {});
      expect(
        linkFilter(config, dstPackInode, x)
      ).toNotExist();
    });
  });

  describe('dstInode same as master', () => {
    it('should exclude', () => {
      const x = R.compose(
        R.assoc('srcEI', masterEI),
        R.assoc('dstEI', linked1)
      )({});
      expect(
        linkFilter(config, dstPackInode, x)
      ).toNotExist();
    });
  });

  describe('different device, same inode', () => {
    it('should exclude', () => {
      const x = R.compose(
        R.assoc('srcEI', masterEI),
        R.assoc('dstEI',
                R.assocPath(['stat', 'dev'], 'def', linked1))
      )({});
      expect(
        linkFilter(config, dstPackInode, x)
      ).toNotExist();
    });
  });

  describe('different size', () => {
    it('should exclude', () => {
      const x = R.compose(
        R.assoc('srcEI', masterEI),
        R.assoc('dstEI',
                R.assocPath(['stat', 'size'], 999, match1))
      )({});
      expect(
        linkFilter(config, dstPackInode, x)
      ).toNotExist();
    });
  });

  describe('different mtime', () => {
    it('should exclude', () => {
      const x = R.compose(
        R.assoc('srcEI', masterEI),
        R.assoc('dstEI',
                R.assocPath(['stat', 'mtime'], new Date(100), match1))
      )({});
      expect(
        linkFilter(config, dstPackInode, x)
      ).toNotExist();
    });
  });

  describe('different size below config.minFileSize', () => {
    it('should exclude', () => {
      const config2 = { minFileSize: 10000 };
      const x = R.compose(
        R.assoc('srcEI', masterEI),
        R.assoc('dstEI', match1)
      )({});
      expect(
        linkFilter(config2, dstPackInode, x)
      ).toNotExist();
    });
  });

  describe('matching files not already linked', () => {
    it('should include', () => {
      const x = R.compose(
        R.assoc('srcEI', masterEI),
        R.assoc('dstEI', match1)
      )({});
      expect(
        linkFilter(config, dstPackInode, x)
      ).toExist();
    });
  });

});
