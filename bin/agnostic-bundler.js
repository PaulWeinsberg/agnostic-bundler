#!/usr/bin/env node

"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const esbuild = require("esbuild");
const sass = require("sass");
const path = require("path");
const glob = require("glob");
const fs = require("fs-extra");
const colors = require("colors");
const postcss_1 = require("postcss");
const autoprefixer = require("autoprefixer");
const postcssInlineSvg = require("postcss-inline-svg");
const browserSync = require("browser-sync");
const precinct = require("precinct");
const arg = require("arg");
let state = 'init';
const detective = precinct.paperwork;
const args = arg({
    '--watch': Boolean,
    '--sourcemap': Boolean,
    '--production': Boolean
});
let Config = JSON.parse(fs.readFileSync(`${__dirname}/../config.default.json`, { encoding: 'utf-8' }));
if (fs.existsSync('config.json')) {
    Config = JSON.parse(fs.readFileSync('config.json', { encoding: 'utf-8' }));
}
const copyEntries = [];
const compiledEntries = [];
const vendorsEntries = [];
const entries = [];
const sources = path.resolve(Config.src);
const dist = path.resolve(Config.dist);
const vendors = Config.vendors.map(vendor => path.resolve(vendor));
Config.compileExtensions.forEach(ext => {
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
const sassDependencies = [];
const esbuildDependencies = [];
const build = (esbuildEntries, sassEntries, copyEntries) => __awaiter(void 0, void 0, void 0, function* () {
    state = 'build';
    console.time('Build duration');
    console.log(colors.black(colors.bgCyan('\n--- Starting build ---\n')));
    if (esbuildEntries)
        yield esbuildTask(esbuildEntries);
    if (sassEntries)
        yield sassTask(sassEntries);
    if (copyEntries)
        yield copyTask(copyEntries);
    if (args['--production'])
        yield removeSourcemap();
    console.log(colors.black(colors.bgCyan('\n--- Build finished ---\n')));
    console.timeEnd('Build duration');
    if (args['--watch'])
        setTimeout(() => {
            state = 'watch';
            console.log(colors.green('\nWatching file changes...\n'));
        }, 1000);
});
const esbuildTask = (entries) => __awaiter(void 0, void 0, void 0, function* () {
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
    };
    for (const file of entries) {
        const deps = detective(file).map(dep => path.resolve(path.dirname(file), dep));
        if (!esbuildDependencies.some(({ entry }) => entry === file))
            esbuildDependencies.push({
                entry: file,
                urls: deps
            });
    }
    yield esbuild.build(options);
});
const sassTask = (entries) => __awaiter(void 0, void 0, void 0, function* () {
    console.log(colors.green('sass compiling...'));
    for (const file of entries) {
        let { css, sourceMap, loadedUrls } = sass.compile(file, Object.assign({ style: 'compressed', sourceMap: args['--sourcemap'] }, Config.sass));
        css = (yield (0, postcss_1.default)([
            autoprefixer(),
            postcssInlineSvg({ removeFill: true })
        ]).process(css, { from: undefined })).css;
        if (args['--sourcemap']) {
            css += `\n/*# sourceMappingURL=${file.replace(/^.*[\\\/]/, '').replace('.scss', '.css.map')} */`;
            yield fs.outputFile(file.replace(sources, dist).replace('.scss', '.css.map'), JSON.stringify(sourceMap), { encoding: 'utf8' });
        }
        yield fs.outputFile(file.replace(sources, dist).replace('.scss', '.css'), css, { encoding: 'utf8' });
        if (!sassDependencies.some(({ entry }) => entry === file))
            sassDependencies.push({
                entry: file,
                urls: loadedUrls.map(({ pathname }) => pathname)
            });
    }
});
const copyTask = (entries) => __awaiter(void 0, void 0, void 0, function* () {
    console.log(colors.green('copying other files...'));
    for (const file of entries) {
        let copyDist = file.replace(sources, dist);
        yield fs.mkdir(path.dirname(copyDist), { recursive: true });
        yield fs.copyFile(file, copyDist);
    }
});
const removeSourcemap = () => __awaiter(void 0, void 0, void 0, function* () {
    const files = glob.sync(`${dist}/**/*.map`);
    for (const file of files)
        yield fs.rm(file);
});
const watchSass = (entry) => __awaiter(void 0, void 0, void 0, function* () {
    let rebuildableEntries = [];
    rebuildableEntries = sassDependencies.filter(dep => dep.urls.includes(entry)).map(dep => dep.entry);
    for (const entry of rebuildableEntries)
        console.log(`${colors.yellow('Added to the queue : ')}${entry.replace(path.resolve(Config.src), '')}`);
    yield build(null, rebuildableEntries);
});
const watchEsbuild = (entry) => __awaiter(void 0, void 0, void 0, function* () {
    let rebuildableEntries = [];
    rebuildableEntries = esbuildDependencies.filter(dep => (dep.urls.includes(entry) || dep.urls.includes(entry.replace(/\..*$/, '')))).map(dep => dep.entry);
    for (const entry of rebuildableEntries)
        console.log(`${colors.yellow('Added to the queue : ')}${entry.replace(path.resolve(Config.src), '')}`);
    yield build(rebuildableEntries);
});
const watchHandler = (entry) => __awaiter(void 0, void 0, void 0, function* () {
    if (state === 'build')
        return;
    console.log(`\n${colors.magenta('Change detected in : ')}${entry.replace(path.resolve(Config.src), '')}\n`);
    if (compiledEntries.includes(entry)) {
        sassEntries.includes(entry) ? yield build(null, [entry]) : yield build([entry]);
    }
    else if (entry.match(/\.scss$/)) {
        yield watchSass(entry);
    }
    else {
        yield watchEsbuild(entry);
    }
});
(() => __awaiter(void 0, void 0, void 0, function* () {
    yield build(esbuildEntries, sassEntries, copyEntries);
    if (args['--watch']) {
        for (const entry of [...entries, ...vendorsEntries]) {
            fs.watchFile(entry, { interval: 1000, persistent: true }, watchHandler.bind(this, entry));
        }
        const bs = browserSync.init(Object.assign({}, Config.browserSync));
        bs.watch(`${dist}/**/*.*`, { usePolling: true }).on('change', bs.reload);
    }
}))();
