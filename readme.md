# Agnostic Bundler

A simple bundler for CMS and other websites that can't be built with new tools and need separate CSS/JS assets.

## Overview

### Features

| Feature                   | Informations                                                                    |
| ------------------------- | ------------------------------------------------------------------------------- |
| Esbuild                   | Base functionnalities (compile, import/export behavior, create bundle etc...)   |
| Typescript                | TypeScript compiler, use babel after compilation (JS and TS consistency)        |
| Sass                      | Transform your SCSS stylesheets to standard CSS                                 |
| PostCSS                   | Concact and organize CSS, mapped with .browserslinkrc like Babel                |
| Autoprefixer              | Autoprefix your CSS for many browsers                                           |
| SVG Inline                | Minify SVG outputed files                                                       |
| ESLint                    | JavaScript/TS linter, make your project sane and robust                         |

### Requirements

| Dependencies              | Version                   |
| ------------------------- | ------------------------- |
| NPM                       | v6.13                     |
| NodeJS                    | v14.14                    |

### Files structure

#### This package

```ini
node_modules/@lorndev/agnostic-bundler
├── .browserslistrc           # Example file for Browserlistrc
├── .eslintrc                 # Example file for Eslint
├── tsconfig.json             # Example TypeScript configuration
└── config.default.json       # Example config.json

# (package.json, .editorconfig...)
```

#### Sources folder (`<project_root>/.bundler` for example)

Your src folder need to be a copy of src_default to start your project.

```ini
src
├── config.json               # Override config.default.json, same function
├── distribution              # Contain project distribution (Not exported at build can only serve dependencies like sass mixins etc)
└── public                    # Exported dir into project public root (for example public dir is <project_root>/web for Drupal 9)

# (package.json, .editorconfig, .git, node_modules ...)
```

## Getting Started

Starting your project from skratch easyly !

### Installation

First step install or create your project root dependencies (Drupal, Wordpress, Symfony, Sylius as you want..).
Follow next steps or just copy this repository as a base : [Bundler src boilerplate](https://github.com/PaulWeinsberg/default-bundler-src)

* Create a folder which contain your sources (`.bundler` for example)
* Run in console npm install `@lorndev/agnostic-bundler`
* Run `npm install`
* Copying `config.default.json` (remove .default) `.eslintrc` `tsconfig.json` and `.browserlistrc` at root of `.bundler`
* Setup your configuration
* Create run scripts in your `package.json` as below :

```json
{
// code ...
  "scripts": {
    "build": "agnostic-bundler --production --lint",
    "dev": "agnostic-bundler --watch --sourcemap --lint"
  }
// code ...
}
```


### Configuration

Your main configuration is in your sources folder, `config.json`, this file override `config.default.json`.

__Take that into consideration :__

Base configuration is an example for Drupal website which has theme named vanksen.
For drupal public folder is `<project_root>/web`, so this is your mapped dir with `<project_root>/.bundler/public` folder and it's mapped with `/` website route.
Remember, your configuration paths **is relative from npm script running folder** in this case `<project_root>/.bundler`.

#### Common configuration

Agnostic bundler package provides a configuration file which is loaded first to configure the bundler.
In most of the cases, this is the only configuration file you need to edit.
See comments below for more informations :

```jsonc
{
  "src": "public",                                                    // The files to compiles
  "dist": "build",                                                    // The compiled file directory
  "vendors": ["distribution"],                                        // Every Sass or JS dependencies that you don't need to parse as entries
  "lintedExtensions": [".js", ".ts", ".jsx", ".tsx"],                 // Extension to check with Eslint
  "compileExtensions": [".js", ".ts", ".scss"],                       // Extension to compile and watch
  "exclude": "/(node_modules|bower_components)/",                     // Excluded regex from src
  "browserSync": {                                                    // Browsersync configuration
    "host": "localhost",
    "proxy": "example.com",
    "port": 4200,
    "ui": { "port": 4201 },
    "open": false,
    "socket": {
      "domain": "localhost:4200"
    },
    "injectChanges": true,
    "watchEvents": ["change"],
    "files": [
      "build/**/*.js",
      "build/**/*.css"
    ],
    "ignore": [
      "build/some-pattern"
    ],
    "watchOptions": {
      "usePolling": true
    }
  },
  "sass": {                                                           // Sass options (override)
    "loadPaths": ["distribution/sass", "node_modules"]
  },
  "esbuild": {                                                        // Esbuild options (override)
    "target": "es6"
  },
  "copy": {                                                           // Copy options
    "ignore": [".ts",".js",".scss",".gitkeep"]
  }
}
```

#### CLI Options

- `--lint` : Enable linter (based on your `.eslint` config file at root)
- `--production` : Minify files and remove sourcemap from dist
- `--sourcemap` : Generate sourcemaps for JS/CSS (TS, Sass etc.)
- `--watch` : Hotreload and browsersync

### Usages

First step, run `npm install`

#### Production and development

Easy to use :

- `npx run agnostic-bundler --lint --watch --sourcemap` : Development
- `npx run agnostic-bundler --lint --production` Production

#### Entries & bundle

**Use bundle functionnality**

All files not prefixed by underscore is a bundle, agnostic-bundler integrate static imports and others depencencies in the generated bundle.
So, use underscore `_` to specify if your file is a dependency.

For example :

`public/_dependency.ts`

```typescript
export class Example {

  private message: string;

  public constructor () {
    this.message = 'Hello World !';
  }

  public displayMessage() {
    return console.log(this.message);
  }
}
```

`public/mybundle.ts`
```typescript
import { Example } from './_dependency';

new Example().displayMessage();
```

In this example, agnostic-bundler generate a file ( `mybundle.js` the bundle) which contain example class and code of `_dependency.ts`.

**Use dynamic imports**

The dynamic import works different, the imported class isn't integrated in the bundled file but a chunks with specific id is generated.
So, when the dynamic import function is called, the chunk file is automatically added to JS file in browser.

For example, to dynamically import bootstrap from `node_modules` :

`public/mybundle.ts`
```typescript
setTimeout(() => {
  import('bootstrap').then(bootstrap => console.log(bootstrap));
},3000)
```


