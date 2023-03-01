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
import { ESLint } from 'eslint';

// @ts-ignore
import * as precinct from 'precinct';
import * as arg from 'arg'

let state: 'build'|'watch'|'init' = 'init';
const detective = precinct.paperwork;

const args = arg({
  '--lint': Boolean,
  '--watch': Boolean,
  '--sourcemap': Boolean,
  '--production': Boolean
});

let Config = JSON.parse(fs.readFileSync(`${__dirname}/../config.default.json`,{ encoding: 'utf-8' }));
if (fs.existsSync('config.json')) Config = JSON.parse(fs.readFileSync('config.json',{ encoding: 'utf-8' }));

const copyEntries: string[] = [];
const compiledEntries: string[] = [];
const vendorsEntries: string[] = [];
const entries: string[] = [];

const outputFiles: string[] = [];

const sources = path.resolve(Config.src);
const dist = path.resolve(Config.dist);
const vendors = (Config.vendors as string[] ?? []).map(vendor => path.resolve(vendor));

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
  outputFiles.splice(0, outputFiles.length);

  console.time('Build duration');
  console.log(colors.black(colors.bgCyan('\n--- Starting build ---\n')));

  try {
    if (args['--lint']) await eslintTask();
    if (esbuildEntries) await esbuildTask(esbuildEntries);
    if (sassEntries) await sassTask(sassEntries);
    if (copyEntries) await copyTask(copyEntries);
    if (args['--production']) await removeSourcemap();

    console.log(colors.black(colors.bgCyan('\n--- Build finished ---\n')));
    console.timeEnd('Build duration');

  } catch (err) {
    console.log(err);
    console.log(colors.bgRed(colors.black('\n--- Build failed ---\n')));
    console.timeEnd('Build duration');

    if (!args['--watch']) process.exit(1);
  }

  if (args['--watch']) setTimeout(() => {
    state = 'watch'
    console.log(colors.green('\nWatching file changes...'));
  }, 1000);
};

const esbuildTask = async (entries: string[]) => {
  console.log(colors.green('→ esbuild compiling...'));
  const options = {
    entryPoints: entries,
    bundle: true,
    write: true,
    outdir: dist,
    minify: true,
    outbase: sources,
    preserveSymlinks: true,
    sourcemap: args['--sourcemap'],
    ...(Config.esbuild ?? {})
  }

  for (const file of entries) {
    const deps = await getEsBuildDependencies(file);

    if (!esbuildDependencies.some(({ entry }) => entry === file)) esbuildDependencies.push({
      entry: file,
      urls: deps
    });
  }

  outputFiles.push(...entries.map(file => file.replace(/\.(jsx?|tsx?)$/, '.js').replace(sources, dist)));

  await esbuild.build(options);
};

const sassTask = async (entries: string []) => {
  console.log(colors.green('→ sass compiling...'));

  for (const file of entries) {
    let { css, sourceMap, loadedUrls } = sass.compile(file, {
      style: 'compressed',
      sourceMap: args['--sourcemap'],
      ...(Config.sass ?? {})
    });

    css = (await postcss([
      autoprefixer(),
      postcssInlineSvg({ removeFill: true })
    ]).process(css, { from: undefined })).css;

    if (args['--sourcemap']) {
      css += `\n/*# sourceMappingURL=${file.replace(/^.*[\\\/]/, '').replace('.scss', '.css.map')} */`
      await fs.outputFile(file.replace(sources, dist).replace('.scss', '.css.map'), JSON.stringify(sourceMap), { encoding: 'utf8' });
    }
    const outfile = file.replace(sources, dist).replace('.scss', '.css');
    outputFiles.push(outfile);

    await fs.outputFile(outfile, css, { encoding: 'utf8' });

    if (!sassDependencies.some(({ entry }) => entry === file)) sassDependencies.push({
      entry: file,
      urls: loadedUrls.map(({ pathname }) => pathname)
    });
  }
};

const copyTask = async (entries: string[]) => {
  console.log(colors.green('→ copying other files...'));

  for (const file of entries) {
    let copyDist = file.replace(sources, dist);
    await fs.mkdir(path.dirname(copyDist), { recursive: true });
    await fs.copyFile(file, copyDist);
  }
}

const removeSourcemap = async () => {
  console.log(colors.green('→ removing sourcemaps...'));

  const files = glob.sync(`${dist}/**/*.map`).filter(file => outputFiles.includes(file.substr(0, file.lastIndexOf('.'))));
  for (const file of files) await fs.unlink(file);
};

const eslintTask = async (): Promise<void> => {
  console.log(colors.green('→ checking script syntax...'));

  const eslint = new ESLint((Config.eslint?.config ?? {}));
  const results = await eslint.lintFiles(
    entries.filter(entry => entry.match(new RegExp(`\.(${(Config.lintedExtensions ?? []).join('|')})$`)))
  );
  const formater = await eslint.loadFormatter('stylish');
  const output = await formater.format(results);
  if (output) console.log(output);

  const hasError = results.some(result => (
    result.errorCount +
    result.fatalErrorCount +
    result.fixableErrorCount
  ));

  if (hasError) throw Error('Some lint errors were found in your dependencies.');
};

const queueAddMessage = (entry: string): void => {
  console.log(`${colors.yellow('Added to the queue : ')}${entry.replace(path.resolve(Config.src), '')}`);
};

const watchSass = async (entry: string) => {
  let rebuildableEntries = [];
  rebuildableEntries = sassDependencies.filter(dep => dep.urls.includes(entry)).map(dep => dep.entry);

  for (const entry of rebuildableEntries) queueAddMessage(entry);

  await build(null, rebuildableEntries);
};

const watchEsbuild = async (entry: string) => {
  let rebuildableEntries = [];
  rebuildableEntries = esbuildDependencies.filter(dep => (
    dep.urls.includes(entry) || dep.urls.includes(entry.substr(0, entry.lastIndexOf('.')))
  )).map(dep => dep.entry);

  for (const entry of rebuildableEntries) queueAddMessage(entry);

  await build(rebuildableEntries);
};

const watchHandler = async (entry: string) => {
  if (state === 'build') return;

  console.log(`\n${colors.magenta('Change detected in : ')}${entry.replace(path.resolve(Config.src), '')}`);

  if (compiledEntries.includes(entry)) {

    queueAddMessage(entry);
    sassEntries.includes(entry) ? await build(null, [entry]) : await build([entry]);

  } else if (entry.match(/\.scss$/)) {

    await watchSass(entry);

  } else {

    await watchEsbuild(entry);

  }
};

const getEsBuildDependencies = async (file: string): Promise<string[]> => {
  const [, dir] = file.match(/(.*\/)(.*)$/);
  file = (await fs.readdir(dir)).map(filename => `${dir}${filename}`).find(dirFile => dirFile.includes(file));
  const dependencies: string[] = (detective(file) as string[]).map(dep => path.resolve(path.dirname(file), dep));
  for (const dep of dependencies) dependencies.push(...(await getEsBuildDependencies(dep)));
  const uniqueDependencies = new Set(dependencies);
  return Array.from(uniqueDependencies);
};

(async () => {

  await build(esbuildEntries, sassEntries, copyEntries);

  if (args['--watch']) {

    for (const entry of [...entries, ...vendorsEntries]) {
      fs.watchFile(entry, { interval: 1000, persistent: true }, watchHandler.bind(this, entry));
    }

    browserSync.init(Config.browserSync ?? {});

  }

})();
