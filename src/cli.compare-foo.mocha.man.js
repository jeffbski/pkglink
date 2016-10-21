/* eslint-disable import/no-extraneous-dependencies */
import expect from 'expect';
import Path from 'path';
import fs from 'fs-extra-promise';

const projectsPath = Path.join(__dirname, '../fixtures/projects');
const masterDir = 'foo1';

const rootDirs = [
  'foo2',
  'foo3',
  'foo4'
];

const filesLinked = [
  'node_modules/define-properties/index.js',
  'node_modules/tmatch/LICENSE',
  'node_modules/tmatch/index.js'
];

const filesNotLinked = [
  'node_modules/define-properties/package.json',
  'node_modules/define-properties/.editorconfig'
];


describe('cli.compare-foo', () => {

  describe('should link master files', () => {
    filesLinked.forEach(f => {
      it(`${masterDir}: ${f}`, () => {
        const p = Path.join(projectsPath, masterDir, f);
        return fs.statAsync(p)
                 .then(stat => stat.nlink)
                 .then(nlink => expect(nlink).toBeGreaterThan(0));
      });
    });
  });


  describe('should link matching files', () => {
    rootDirs.forEach(root => {
      filesLinked.forEach(f => {
        it(`${root}: ${f}`, () => {
          const p1 = Path.join(projectsPath, masterDir, f);
          const p2 = Path.join(projectsPath, root, f);
          let p1Stat;
          return fs.statAsync(p1)
                   .then(stat1 => { p1Stat = stat1; })
                   .then(() => fs.statAsync(p2))
                   .then(stat2 => {
                     expect(stat2.ino).toBe(p1Stat.ino);
                   });
        });
      });
    });
  });

  describe('should not link non-matching files', () => {
    rootDirs.forEach(root => {
      filesNotLinked.forEach(f => {
        it(`${root}: ${f}`, () => {
          const p1 = Path.join(projectsPath, masterDir, f);
          const p2 = Path.join(projectsPath, root, f);
          let p1Stat;
          return fs.statAsync(p1)
                   .then(stat1 => { p1Stat = stat1; })
                   .then(() => fs.statAsync(p2))
                   .then(stat2 => {
                     expect(stat2.ino).toNotBe(p1Stat.ino);
                   });
        });
      });
    });
  });

});
