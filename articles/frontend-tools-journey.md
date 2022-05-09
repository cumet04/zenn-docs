---
title: ""
emoji: "💭"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: []
published: false
---


ブラウザ上で動くサイトやアプリケーションを作る場合、サイト閲覧へのリクエストに対しhtmlを返し、その中でcssやjsを読み込むことになります。
極限までシンプルなものとしては、こうです。

```html
<html>
  <head>
    <link rel="stylesheet" href="/app.css" />
    <title>うぇぶさいと</title>
  </head>
  <body>
    <h1>うぇぶさいとだよ</h1>
    <script src="/app.js"></script>
  </body>
</html>
```

原理的には、このままこのhtmlのソースと`app.css`と`app.js`を書いていけば、任意のWebサイトを開発することは可能なはずです。
しかし現実的にはこのまま進めるにはつらいことも多く、もっと便利にしていきます。

* いきなりモジュールバンドラは重い気がする、babelやtsが先でもいいかも
* 実際にツールで動かせる順番でいくか？だとするとwebpackが最初？
* できればgulpも比較対象として入れたい
* npmの話を入れるか悩む

## 新しいJavaScriptやTypeScriptを使いたい
transpile
babel, tsc

https://t-yng.jp/post/tsc-and-babel
babelはjsトランスパイルがメインでpolyfillもちゃんとやる(Promiseとか。とはいえそれはcore-js)
tscは構文変換なのでpolyfillは仕事じゃない

※babelもtsトランスパイルできるし、babel/tscもjsx/tsxを解釈できる

-----

言語の新しい構文や機能を使うといい感じにコードが書けますが、古いブラウザがそれをサポートしていないことがあります。
コーダーが新しい機能を使いつつ、ユーザは古いブラウザでも利用できるためには **transpile** や **polyfill** が必要になります。

:::message
「トランスパイル」「コンパイル」「トランスコンパイル」と言い方はあれこれですが、本記事中では「トランスパイル(transpile)」で統一します。

筆者の観測範囲ではトランスパイルと呼ばれることが多い印象ですが、[babel](https://babeljs.io/)は "Babel is a JavaScript compiler." と言っているし、[tscのドキュメント](https://www.typescriptlang.org/docs/handbook/compiler-options.html)でも "Running tsc locally will compile the closest project defined by ..." とあります。どうしようか悩んだのですが、界隈でよく聞く/なんとなく伝わるであろう可能性に賭けました。

ここの悩みについては、参考になりそうなstackoverflowの質問があったので貼っておきます: https://stackoverflow.com/questions/44931479/compiling-vs-transpiling
:::

### Babel (transpile)
```main.js:javascript
const el = document.getElementById("button");

el?.addEventListener("click", () => {
  const data = {
    date: new Date(),
    message: "hello",
    count: 3
  };
  alert(JSON.stringify(data));
})
```

```
npm install @babel/core @babel/cli
mkdir out
npx babel main.js --out-dir out
```

```out/main.js:javascript
const el = document.getElementById("button");
el?.addEventListener("click", () => {
  const data = {
    date: new Date(),
    message: "hello",
    count: 3
  };
  alert(JSON.stringify(data));
});
```

...ほとんど変わってません。一応空行が消えてるので、なにか処理はされているのでしょう。
とはいえconfigを何も渡していない（暗黙の了解でES5相当にしてほしいと願ったが、babelにそんなことは伝えていない）ので、そんなもんです。

というわけで
```
npm install @babel/preset-env
```

```babel.config.json
{
  "presets": ["@babel/preset-env"]
}
```

本記事で真面目にbabelのconfigを精査するのは目的外なので、雑にpreset-envを突っ込みます。
<!-- TODO: preset-envにES5的なオプションがあるのを確認する -->

```
npx babel main.js --out-dir out
```

```out/main.js:javascript
"use strict";

var el = document.getElementById("button");
el === null || el === void 0 ? void 0 : el.addEventListener("click", function () {
  var data = {
    date: new Date(),
    message: "hello",
    count: 3
  };
  alert(JSON.stringify(data));
});
```

* [`"use strict";`](https://developer.mozilla.org/ja/docs/Web/JavaScript/Reference/Strict_mode)が入った
* `const el`が`var el`になった
* [optional chaining](https://developer.mozilla.org/ja/docs/Web/JavaScript/Reference/Operators/Optional_chaining)がごちゃっとして三項演算子になった
* [アロー関数式](https://developer.mozilla.org/ja/docs/Web/JavaScript/Reference/Functions/Arrow_functions)が`function () {`になった

この`out/main.js`をhtmlのscriptタグで読み込むようにすればIE11など古いのでも動きますね

### TypeScript

```main.ts:typescript
type Data = {
  date: Date;
  message: string;
  count: number;
}

const el = document.getElementById("button");

el?.addEventListener("click", () => {
  const data: Data = {
    date: new Date(),
    message: "hello",
    count: 3
  };
  alert(JSON.stringify(data));
})
```

```
npm install typescript
npx tsc main.ts
```

```main.js:javascript
var el = document.getElementById("button");
el === null || el === void 0 ? void 0 : el.addEventListener("click", function () {
    var data = {
        date: new Date(),
        message: "hello",
        count: 3
    };
    alert(JSON.stringify(data));
});
```

* 型情報が消えている
* ES5相当になっている（tsconfigのデフォルト値を参照する）


### core-js (polyfill)
babelでもtscでもES5で動くコードが出来上がるのでtscがあればbabelは不要かというとそうでもない場合があって、tsc単体ではできないこととして **polyfill** があります。

https://t-yng.jp/post/tsc-and-babel

```
npm install @babel/core @babel/cli @babel/preset-env
```

```babel.config.json
{
  "presets": [
    [
      "@babel/preset-env",
      {
        "targets": { "ie": "11" },
        "useBuiltIns": "usage"
      }
    ]
  ]
}
```

```
mkdir out
npx babel main.js --out-dir out
```

```main.js:javascript
const p = new Promise((resolve, reject) => resolve(0));
p.then((num) => alert(num));
```

```out/main.js:javascript
"use strict";

require("core-js/modules/es6.object.to-string.js");

require("core-js/modules/es6.promise.js");

var p = new Promise(function (resolve, reject) {
  return resolve(0);
});
p.then(function (num) {
  return alert(num);
});
```


`require("core-js/modules/es6.object.to-string.js");`
https://github.com/zloirock/core-js/blob/v3.21.0/packages/core-js/modules/es.object.to-string.js
https://github.com/zloirock/core-js/blob/v3.21.0/packages/core-js/internals/object-to-string.js
https://github.com/zloirock/core-js/blob/v3.21.0/packages/core-js/internals/to-string-tag-support.js

※Object.prototype.toStringとか対応してない環境あんま無いと思うのだが、パッと解説できる実装規模でちょうどいいのがこれだった。
[Promiseのやつ](https://github.com/zloirock/core-js/blob/v3.21.0/packages/core-js/modules/es.promise.js)とか読むのつらすぎる

## cjs/mjs
core-jsがrequireで差し込まれるので解説せざるを得ない
dynamic importの話もまとめる？

cjs -> mjsは単体変換ツールが無い（browserifyはbundleもやる＆bundleは見た目がわかりにくい）ので解説しにくい
webpackを先にやってからついでに載せる？

https://qiita.com/yusuke_ten/items/a40ec089c55599ce1b3e
序盤の歴史は参考にできる（webpack以降はちと方針が合わない）

https://webpack.js.org/api/module-methods/

## ファイルを分割したい
* そのまま結合した場合の話
* namespaced

ファイル結合
モジュールバンドラ

## 画像アセットを使いたい
bundler (webpack)

## フレームワークやscssとか使いたい
変換したりするやつ

babelとts, cssフレームワーク, React/Vueをどの粒度に分けるか悩む

## 少しでも閲覧を早くしたい
minify

## ブラウザで動いてるコードからデバッグしたい
sourcemap

## 開発中にブラウザリロードしたくない
devserver
live-reload

## 「古いキャッシュが読まれてる...」から開放されたい
ファイル末尾hash

## 動的にスクリプトを読み込みたい
es module

※これだけツールじゃない。ただこの話をしないとviteやsnowpackの話ができない

## ビルド早くしたい
esbuild, swc
vite, snowpack
