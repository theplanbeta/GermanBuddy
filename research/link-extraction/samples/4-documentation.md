# Documentation / technical blog (V8 blog, code listings)

Source: https://v8.dev/blog/
Extractor chosen: readability (candidates: readability 2345w, defuddle 2345w)
Language: en

| | words | listening time at 165 wpm |
|---|---|---|
| BEFORE (whole page text) | 2534 | 15 min |
| AFTER (default listening text) | 2381 | 14 min |

## What Hearshot announces first

> standalone WebAssembly binaries using Emscripten.

## BEFORE: first 900 characters of raw page text

```
V8
Show navigation
Home
Blog
Docs
JS/Wasm features
Research
Outside the web: standalone WebAssembly binaries using Emscripten
Published 21 November 2019 · Tagged with WebAssembly tooling
Emscripten has always focused first and foremost on compiling to the Web and other JavaScript environments like Node.js. But as WebAssembly starts to be used without JavaScript, new use cases are appearing, and so we've been working on support for emitting standalone Wasm files from Emscripten, that do not depend on the Emscripten JS runtime! This post explains why that's interesting.
Using standalone mode in Emscripten #
First, let's see what you can do with this new feature! Similar to this post let's start with a "hello world" type program that exports a single function that adds two numbers:
// add.c
#include <emscripten.h>
EMSCRIPTEN_KEEPALIVE
int add(int x, int y) {
return x + y;
}
We'd normally bu
```

## AFTER: first 1,800 characters of the listening text

standalone WebAssembly binaries using Emscripten.
Emscripten has always focused first and foremost on compiling to the Web and other JavaScript environments like Node.js. But as WebAssembly starts to be used without JavaScript, new use cases are appearing, and so we've been working on support for emitting standalone Wasm files from Emscripten, that do not depend on the Emscripten JS runtime! This post explains why that's interesting.

## Using standalone mode in Emscripten

First, let's see what you can do with this new feature! Similar to this post let's start with a "hello world" type program that exports a single function that adds two numbers:
[Code example skipped.]
We'd normally build this with something like emcc -O3 add.c -o add.js which would emit add.js and add.wasm. Instead, let's ask emcc to only emit Wasm:
[Code example skipped.]
When emcc sees we only want Wasm then it makes it "standalone" - a Wasm file that can run by itself as much as possible, without any JavaScript runtime code from Emscripten.
Disassembling it, it's very minimal - just 87 bytes! It contains the obvious add function
[Code example skipped.]
and one more function, _start,
[Code example skipped.]
_start is part of the WASI spec, and Emscripten's standalone mode emits it so that we can run in WASI runtimes. (Normally _start would do global initialization, but here we just don't need any so it's empty.)

## Write your own JavaScript loader

One nice thing about a standalone Wasm file like this is that you can write custom JavaScript to load and run it, which can be very minimal depending on your use case. For example, we can do this in Node.js:
[Code example skipped.]
Just 4 lines! Running that prints 42 as expected. Note that while this example is very simplistic, there are cases where yo

## AFTER: last 600 characters

un in WASI runtimes, but you can use them on the Web and you can write your own JS runtime for them. You can also use them as plugins; for example, a game engine could have plugins that render using OpenGL, and the developer would compile them in standalone mode and then implement the OpenGL imports in the engine's Wasm runtime. Standalone Wasm mode still helps here because it makes the output as standalone as Emscripten can make it.
You may also find APIs that do have a non-JS replacement that we haven’t converted yet, as work is still ongoing. Please file bugs, and as always help is welcome!

## Left out by default (counts, with examples)

- **code**: 10 block(s), e.g. "// add.c#include <emscripten.h>EMSCRIPTEN_KEEPALIVEint add(int x, int y) { return x + y;}"; "emcc -O3 add.c -o add.wasm"
