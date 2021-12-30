#!/usr/bin/env node

import * as esbuild from 'esbuild';
import * as sass from 'sass';
import * as path from 'path';
import * as glob from 'glob';
import * as fs from 'fs-extra';
import * as colors from 'colors';
import postcss from 'postcss';
import * as autoprefixer from 'autoprefixer';
import * as postcssInlineSvg from 'postcss-inline-svg';
import * as browserSync from 'browser-sync';
// @ts-ignore
import * as precinct from 'precinct';
import * as arg from 'arg'


let state: 'build'|'watch'|'init' = 'init';
const detective = precinct.paperwork;
const args = arg({
  '--watch': Boolean,
  '--sourcemap': Boolean,
  '--production': Boolean
});

let Config = JSON.parse(fs.readFileSync(`${__dirname}/../config.default.json`,{ encoding: 'utf-8' }));
if (fs.existsSync('config.json')) {
  Config = JSON.parse(fs.readFileSync('config.json',{ encoding: 'utf-8' }))
}

const copyEntries: string[] = [];
const compiledEntries: string[] = [];
const vendorsEntries: string[] = [];
const entries: string[] = [];

const sources = path.resolve(Config.src);
const dist = path.resolve(Config.dist);
const vendors = (Config.vendors as string[]).map(vendor => path.resolve(vendor));

(Config.compileExtensions as string[]).forEach(ext => {
  vendors.forEach(vendor => {
    glob.sync(`${vendor}/**/*${ext}`).forEach(path => {
      vendorsEntries.push(path);
    });
  });
  glob.sync(`${sources}/**/*${ext}`).forEach(path => {
    entries.push(path);
    if (!path.replace(/^.*[\\\/]/, '').match(/^_.*/) && !path.match(Config.exclude)) {
      compiledEntries.push(path);
    }
  });
});

glob.sync(`${sources}/**/*.*`).forEach(path => {
  if (!path.replace(/^.*[\\\/]/, '').match(new RegExp(`.*(${Config.copy.ignore.join('|')})$`)) && !path.match(Config.exclude)) {
    copyEntries.push(path);
  }
});

const sassEntries = compiledEntries.filter(file => file.includes('.scss'));
const esbuildEntries = compiledEntries.filter(file => !sassEntries.includes(file));
const sassDependencies: { entry: string; urls: string[] }[] = [];
const esbuildDependencies: { entry: string; urls: string[] }[] = [];

const build = async (esbuildEntries?: string[], sassEntries?: string[], copyEntries?: string[]) => {
  state = 'build';

  console.time('Build duration');
  console.log(colors.black(colors.bgCyan('\n--- Starting build ---\n')));

  if (esbuildEntries) await esbuildTask(esbuildEntries);
  if (sassEntries) await sassTask(sassEntries);
  if (copyEntries) await copyTask(copyEntries);
  if (args['--production']) await removeSourcemap();

  console.log(colors.black(colors.bgCyan('\n--- Build finished ---\n')));
  console.timeEnd('Build duration');

  if (args['--watch']) setTimeout(() => {
    state = 'watch'
    console.log(colors.green('\nWatching file changes...\n'));
  }, 1000);
}

const esbuildTask = async (entries: string[]) => {
  console.log(colors.green('esbuild compiling...'));
  const options = {
    entryPoints: entries,
    bundle: true,
    write: true,
    outdir: dist,
    minify: true,
    outbase: sources,
    preserveSymlinks: true,
    sourcemap: args['--sourcemap']
  }

  for (const file of entries) {
    const deps = (detective(file) as string[]).map(dep => path.resolve(path.dirname(file), dep));

    if (!esbuildDependencies.some(({ entry }) => entry === file)) esbuildDependencies.push({
      entry: file,
      urls: deps
    });
  }

  await esbuild.build(options);
}

const sassTask = async (entries: string []) => {
  console.log(colors.green('sass compiling...'));

  for (const file of entries) {
    let { css, sourceMap, loadedUrls } = sass.compile(file, {
      style: 'compressed',
      sourceMap: args['--sourcemap'],
      ...Config.sass
    });

    css = (await postcss([
      autoprefixer(),
      postcssInlineSvg({ removeFill: true })
    ]).process(css, { from: undefined })).css;

    if (args['--sourcemap']) {
      css += `\n/*# sourceMappingURL=${file.replace(/^.*[\\\/]/, '').replace('.scss', '.css.map')} */`
      await fs.outputFile(file.replace(sources, dist).replace('.scss', '.css.map'), JSON.stringify(sourceMap), { encoding: 'utf8' });
    }

    await fs.outputFile(file.replace(sources, dist).replace('.scss', '.css'), css, { encoding: 'utf8' });

    if (!sassDependencies.some(({ entry }) => entry === file)) sassDependencies.push({
      entry: file,
      urls: loadedUrls.map(({ pathname }) => pathname)
    });
  }
}

const copyTask = async (entries: string[]) => {
  console.log(colors.green('copying other files...'));

  for (const file of entries) {
    let copyDist = file.replace(sources, dist);
    await fs.mkdir(path.dirname(copyDist), { recursive: true });
    await fs.copyFile(file, copyDist);
  }
}

const removeSourcemap = async () => {
  const files = glob.sync(`${dist}/**/*.map`);
  for (const file of files) await fs.unlink(file);
}

const watchSass = async (entry: string) => {
  let rebuildableEntries = [];
  rebuildableEntries = sassDependencies.filter(dep => dep.urls.includes(entry)).map(dep => dep.entry);

  for (const entry of rebuildableEntries) console.log(`${colors.yellow('Added to the queue : ')}${entry.replace(path.resolve(Config.src), '')}`);

  await build(null, rebuildableEntries);
}

const watchEsbuild = async (entry: string) => {
  let rebuildableEntries = [];
  rebuildableEntries = esbuildDependencies.filter(dep => (dep.urls.includes(entry) || dep.urls.includes(entry.replace(/\..*$/, '')))).map(dep => dep.entry);

  for (const entry of rebuildableEntries) console.log(`${colors.yellow('Added to the queue : ')}${entry.replace(path.resolve(Config.src), '')}`);

  await build(rebuildableEntries);
}

const watchHandler = async (entry: string) => {
  if (state === 'build') return;

  console.log(`\n${colors.magenta('Change detected in : ')}${entry.replace(path.resolve(Config.src), '')}\n`);

  if (compiledEntries.includes(entry)) {

    sassEntries.includes(entry) ? await build(null, [entry]) : await build([entry]);

  } else if (entry.match(/\.scss$/)) {

    await watchSass(entry);

  } else {

    await watchEsbuild(entry);

  }
}

(async () => {

  await build(esbuildEntries, sassEntries, copyEntries);

  if (args['--watch']) {

    for (const entry of [...entries, ...vendorsEntries]) {
      fs.watchFile(entry, { interval: 1000, persistent: true }, watchHandler.bind(this, entry));
    }

    browserSync.init({ ...Config.browserSync });

  }

})();
