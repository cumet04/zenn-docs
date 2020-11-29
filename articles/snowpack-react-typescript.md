---
title: "Snowpack+React+Typescriptを公式手順でinitする"
emoji: "🦁"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [typescript, react, snowpack, 環境構築]
published: false
---

:::message
この記事は2020年6月20日にqiitaに投稿したものの移行記事となります。
元記事はこちら https://qiita.com/cumet04/items/9950ad9d3218edef3141
:::

趣味でVueを触っている筆者がReactに入門してみたので、調査・実施した初期構築のメモです。
最初はスタンダードに[`create-react-app`](https://create-react-app.dev/)していたのですが、Vueの[vite](https://github.com/vitejs/vite)のスピード感を体験していたためwebpack環境に我慢できず、[snowpack](https://www.snowpack.dev/)を使うことにしました。

参考までに、以下の内容を実施したリポジトリです: https://github.com/cumet04/snow-react-ts-init


## はじめに; 参考
本記事と同様にSnowpack + React + Typescriptな環境を作る記事として

https://qiita.com/nabeliwo/items/67cc7f2c67c905eddbc7
https://qiita.com/kazuma1989/items/2545845087b86e35b9ce

などがあり、これらでは利用するreactパッケージの指定やimportパス、babelのプラグインなどを設定していますが、本記事執筆時点ではsnowpack公式の[Create Snowpack App (CSA)](https://www.snowpack.dev/#create-snowpack-app-(csa))が存在しており^[[create-snowpack-appのinitial commitは4/22](https://github.com/pikapkg/create-snowpack-app/commit/30ed6d2606f0f98e83d482309de99230900de5a3#diff-9879d6db96fd29134fc802214163b95a)となっており、参考記事執筆時には存在しなかったようです] ^[後日追記: Snowpack 2.0としてCSAが公開されたかたちなのですが、初期執筆時に筆者がそのあたりの経緯を知らなかった（CSAがおもむろに登場したと思っていた）ため文章の表現に少し違和感があるかもしれません]非常に簡単に入門できるようになっています。


初期公開後追記:
上記参考記事はSnowpack v1の頃の話で、本記事で対象にしているCSAは[Snowpack 2.0のリリース](https://www.snowpack.dev/posts/2020-05-26-snowpack-2-0-release/)とともに公開されたもの、ということのようです。

また本記事ではSnowpackとはなにか・そもそも何をしているのか等は一切気にせずスッとinitするだけに留まるため、そのあたりの背景が気になる方は上記参考記事、また後者の筆者の方が2.0について書かれた下記を参考にするとよいと思います。

https://qiita.com/kazuma1989/items/30676cb3d2da1c873507


## ひとまずinitする
Create Snowpack Appを使ってプロジェクトを作成します。
[公式手順](https://www.snowpack.dev/#create-snowpack-app-(csa))の通りですが、ここではReact + Typescriptなので以下のようになります:

```
npx create-snowpack-app {プロジェクト名} --template @snowpack/app-template-react-typescript
```

実行すると

* カレントディレクトリに`{プロジェクト名}`のディレクトリが作成される
* 上記ディレクトリ下にテンプレート一式が展開され、initial commitが打たれる
* `npm install`が実行される

状態になります。
作成されたディレクトリ下で`npm start`するとsnowpackのdevサーバが起動します。

なお、この時点で何もせずとも[Hot Reloadが有効](https://www.snowpack.dev/#hot-module-replacement)です。`src/App.tsx`あたりを編集すると即時反映されるかと思います。

### TypeScriptについて
create時にテンプレとしてtypescriptを指定しておけば、特に何もせずとも`.ts`(`.tsx`)が使えます。
本記事はタイトルにTypescriptと入っていますが、特別な操作は不要なためこれ以降tsの話はありません。

またdevサーバ実行時やビルド時には`tsc --noEmit`が走るようになっており、型チェックの面でもデフォルトのままで安心です。

### （一部WSLユーザのみ）devサーバが起動するようにする

筆者がそうなのですが、WSLユーザかつWSL内のPATHにWindowsのもの含めないようにしていた場合、この初期状態ではdevサーバが起動しません。
これはcreate-react-appと同じ問題で、あちらでは[起動コマンドに`BROWSER=none`を足すと解決する](https://github.com/facebook/create-react-app/issues/7251#issuecomment-511385531)のですが、snowpackの場合は起動コマンドに`--open none`を足すことで解決できます。

```diff:package.json
{
  "scripts": {
-    "start": "snowpack dev",
+    "start": "snowpack dev --open none",
    "build": "snowpack build",
    "test": "jest",
    "format": "prettier --write \"src/**/*.{js,jsx,ts,tsx}\"",
```
commit: https://github.com/cumet04/snow-react-ts-init/commit/f0561178cf73f0da0fc43822439d581f86bb3a38


## postcssを動かす
プロジェクト内のcssでPostCSSが機能するようにします。

[公式手順](https://www.snowpack.dev/#postcss)の通りなのですが、`postcss-cli`パッケージの追加・`snowpack.config.json`への追記を行えばよいです。
postcssの設定は特に特殊なことはなく、`postcss.config.js`でも`package.json`でも好きなところに記述できます。

```diff:snowpack.config.json
{
  "extends": "@snowpack/app-scripts-react",
-  "scripts": {},
+  "scripts": {
+    "build:css": "postcss"
+  },
  "plugins": []
}
```

下記commitでは、動作テストとして`postcss-nesting`を追加し`App`のcssを変更しています。
commit: https://github.com/cumet04/snow-react-ts-init/commit/ef9ba8f7513738362dc5204c29cf4ef852010483


## CSS Moduleする
cssをscopedに書きたいのでCSS Moduleします。

こちらは特に作業は必要なく、ファイル名を変更して[そのまま使えます](https://www.snowpack.dev/#import-css-modules)。
commit: https://github.com/cumet04/snow-react-ts-init/commit/49684b94d31fd3b8940984519edd9f9f41a275e0


## bundleなproduction buildする
snowpackはasset bundleを行わないため、デフォルトではproduction buildでも全ソースが別個のファイルになります。

bundleしたい場合、[公式手順](https://www.snowpack.dev/#bundle-for-production)としてはwebpackを使うプラグインが提供されているため^[公式サイトではなくCSAのリポジトリによると[parcelでbundleするプラグインも提供されている](https://github.com/pikapkg/create-snowpack-app/#bundle)ようです]、これを使います。
その場合は`@snowpack/plugin-webpack`を`npm install`し`snowpack.config.json`に下記追記します:

```diff:snowpack.config.json
  "scripts": {
    "build:css": "postcss"
  },
-  "plugins": []
+  "plugins": [["@snowpack/plugin-webpack", {}]]
}
```
commit: https://github.com/cumet04/snow-react-ts-init/commit/92e15f7bba7b9c72e95c59594f94ca15b074136c

この状態で`npm run build`すると、bundleされた状態のビルドが出来上がります。


## （おまけ）@octokit/request (node-fetch) を使う
別の個人プロジェクトで[@octokit/rest](https://github.com/octokit/rest.js/)を使うとしたところ、`node-fetch`パッケージのNode built-inパッケージの問題に当たりました。
通常、[公式のトラブルシューティング](https://www.snowpack.dev/#node-built-in-could-not-be-resolved)にあるように`rollup-plugin-node-polyfills`を使うなどすればよいのかもしれませんが、この場合はrollupの`plugin-node-XXX`を色々試しても解決できませんでした。

そこで「SPAだしブラウザでしか動かさないわけでnode-fetch使わず普通のfetchでよくない？」という発想の元、node_modules内の`@octokit/request`のソースを直接書き換えることにしました。

```bash:lib/patch.sh
#!/bin/bash

set -eu
cd $(dirname $0)/..

file="node_modules/@octokit/request/dist-web/index.js"
before=$(cat $file)
sed -i 's|^import nodeFetch|//import nodeFetch|' $file
sed -i 's|^\s*const fetch|//const fetch|' $file

# display changed lines
echo "$before" | diff - $file
```
commit: https://github.com/cumet04/snow-react-ts-init/commit/0aeb3d8449b65ce5c476abbffd65eb884fe82688

`fetch`を使うところが抽象化されてまとまっていたため、`node-fetch`のimportと`fetch`の定義書き換え部分をコメントアウトするだけとなっています。

ゴリ押し解決のため`node-fetch`以外のNode built-inパッケージ問題には適用できませんが、同じようなハマり方をしているかたの参考になれば。

※もっと真っ当な方法で対応＆実際に動作する方法があればご教示いただけると。。。


## まとめ
基本的なところは公式が提供してくれており、ぶっちゃけ公式ドキュメントの紹介みたいになってしまいました。

まだこれでちゃんとしたプロダクトを書いたわけでは全くなく、特殊なユースケースでは難しいこともあるかもしれませんが、これらの基本的なところは安心の公式手順で楽しめそうです。
