#!/usr/bin/env node
"use strict";
var _a;
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
const eslint_1 = require("eslint");
const precinct = require("precinct");
const arg = require("arg");
let state = 'init';
const detective = precinct.paperwork;
const args = arg({
    '--lint': Boolean,
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
const vendors = ((_a = Config.vendors) !== null && _a !== void 0 ? _a : []).map(vendor => path.resolve(vendor));
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
const build = async (esbuildEntries, sassEntries, copyEntries) => {
    let lintError = false;
    state = 'build';
    console.time('Build duration');
    console.log(colors.black(colors.bgCyan('\n--- Starting build ---\n')));
    if (args['--lint'] && await eslintTask()) {
        console.log(colors.bgRed(colors.black('Error found in your dependencies, fix them or disable eslint by removing --lint flag to build.\n')));
        lintError = true;
    }
    if (!lintError) {
        if (esbuildEntries)
            await esbuildTask(esbuildEntries);
        if (sassEntries)
            await sassTask(sassEntries);
        if (copyEntries)
            await copyTask(copyEntries);
        if (args['--production'])
            await removeSourcemap();
    }
    console.log(colors.black(colors.bgCyan('\n--- Build finished ---\n')));
    console.timeEnd('Build duration');
    if (args['--watch'])
        setTimeout(() => {
            state = 'watch';
            console.log(colors.green('\nWatching file changes...'));
        }, 1000);
};
const esbuildTask = async (entries) => {
    var _a;
    console.log(colors.green('→ esbuild compiling...'));
    const options = Object.assign({ entryPoints: entries, bundle: true, write: true, outdir: dist, minify: true, outbase: sources, preserveSymlinks: true, sourcemap: args['--sourcemap'] }, ((_a = Config.esbuild) !== null && _a !== void 0 ? _a : {}));
    for (const file of entries) {
        const deps = detective(file).map(dep => path.resolve(path.dirname(file), dep));
        if (!esbuildDependencies.some(({ entry }) => entry === file))
            esbuildDependencies.push({
                entry: file,
                urls: deps
            });
    }
    await esbuild.build(options);
};
const sassTask = async (entries) => {
    var _a;
    console.log(colors.green('→ sass compiling...'));
    for (const file of entries) {
        let { css, sourceMap, loadedUrls } = sass.compile(file, Object.assign({ style: 'compressed', sourceMap: args['--sourcemap'] }, ((_a = Config.sass) !== null && _a !== void 0 ? _a : {})));
        css = (await (0, postcss_1.default)([
            autoprefixer(),
            postcssInlineSvg({ removeFill: true })
        ]).process(css, { from: undefined })).css;
        if (args['--sourcemap']) {
            css += `\n/*# sourceMappingURL=${file.replace(/^.*[\\\/]/, '').replace('.scss', '.css.map')} */`;
            await fs.outputFile(file.replace(sources, dist).replace('.scss', '.css.map'), JSON.stringify(sourceMap), { encoding: 'utf8' });
        }
        await fs.outputFile(file.replace(sources, dist).replace('.scss', '.css'), css, { encoding: 'utf8' });
        if (!sassDependencies.some(({ entry }) => entry === file))
            sassDependencies.push({
                entry: file,
                urls: loadedUrls.map(({ pathname }) => pathname)
            });
    }
};
const copyTask = async (entries) => {
    console.log(colors.green('→ copying other files...'));
    for (const file of entries) {
        let copyDist = file.replace(sources, dist);
        await fs.mkdir(path.dirname(copyDist), { recursive: true });
        await fs.copyFile(file, copyDist);
    }
};
const removeSourcemap = async () => {
    console.log(colors.green('→ removing sourcemaps...'));
    const files = glob.sync(`${dist}/**/*.map`);
    for (const file of files)
        await fs.unlink(file);
};
const eslintTask = async () => {
    var _a, _b;
    console.log(colors.green('→ checking script syntax...'));
    const eslint = new eslint_1.ESLint(((_b = (_a = Config.eslint) === null || _a === void 0 ? void 0 : _a.config) !== null && _b !== void 0 ? _b : {}));
    const results = await eslint.lintFiles(entries.filter(entry => { var _a; return entry.match(new RegExp(`\.(${((_a = Config.lintedExtensions) !== null && _a !== void 0 ? _a : []).join('|')})$`)); }));
    const formater = await eslint.loadFormatter('stylish');
    const output = formater.format(results);
    if (output.length)
        console.log(output);
    return results.some(result => (result.errorCount +
        result.fatalErrorCount +
        result.fixableErrorCount));
};
const queueAddMessage = (entry) => {
    console.log(`${colors.yellow('Added to the queue : ')}${entry.replace(path.resolve(Config.src), '')}`);
};
const watchSass = async (entry) => {
    let rebuildableEntries = [];
    rebuildableEntries = sassDependencies.filter(dep => dep.urls.includes(entry)).map(dep => dep.entry);
    for (const entry of rebuildableEntries)
        queueAddMessage(entry);
    await build(null, rebuildableEntries);
};
const watchEsbuild = async (entry) => {
    let rebuildableEntries = [];
    rebuildableEntries = esbuildDependencies.filter(dep => (dep.urls.includes(entry) || dep.urls.includes(entry.substr(0, entry.lastIndexOf('.'))))).map(dep => dep.entry);
    for (const entry of rebuildableEntries)
        queueAddMessage(entry);
    await build(rebuildableEntries);
};
const watchHandler = async (entry) => {
    if (state === 'build')
        return;
    console.log(`\n${colors.magenta('Change detected in : ')}${entry.replace(path.resolve(Config.src), '')}`);
    if (compiledEntries.includes(entry)) {
        queueAddMessage(entry);
        sassEntries.includes(entry) ? await build(null, [entry]) : await build([entry]);
    }
    else if (entry.match(/\.scss$/)) {
        await watchSass(entry);
    }
    else {
        await watchEsbuild(entry);
    }
};
(async () => {
    var _a;
    await build(esbuildEntries, sassEntries, copyEntries);
    if (args['--watch']) {
        for (const entry of [...entries, ...vendorsEntries]) {
            fs.watchFile(entry, { interval: 1000, persistent: true }, watchHandler.bind(this, entry));
        }
        browserSync.init((_a = Config.browserSync) !== null && _a !== void 0 ? _a : {});
    }
})();
