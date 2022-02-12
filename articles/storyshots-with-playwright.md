---
title: "PlaywrightでStorybookのブラウザ毎キャプチャを撮ってみる"
emoji: "📸"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [storybook, playwright]
published: false
---

先日、サービスの本番環境にて、検証から漏れていたブラウザでの見た目が崩れていることに気付きました。

「ウッ...デバイス/ブラウザ検証やっとけという話ではあるがしかし...ぶっちゃけめんどくさい！」

ということで、PlaywrightでStorybookのブラウザ毎キャプチャを撮ってみる技術検証をやりました。

:::message alert
最終的に割とシンプルな構成・設定に仕上がっていると思っていますが、根本的なところで正道から外れた挙動※に依存しています。そのため、将来的に安定して動くことが全く保証されない点についてはご了承ください。

※Playwrightに正式対応していないaddonにPlaywrightを入れたらとりあえず動く
:::


## アイデア
* [Playwright](https://playwright.dev/)を使えば、キャプチャを含む各種主要ブラウザ[^1]での操作・検証ができる
* Storybookに各コンポーネントはそこそこ揃えているので、その仕組みに乗っかって網羅的にキャプチャが取れると簡単そう
* Storybookのキャプチャをpuppeteerで実現する[addon-storyshots-puppeteer](https://storybook.js.org/addons/@storybook/addon-storyshots-puppeteer)にて、[puppeteerの代わりにPlaywrightのブラウザのインスタンスを突っ込んだら動いた](https://github.com/storybookjs/storybook/issues/10162#issuecomment-690423930)と言ってる人がいる

[^1]: ブラウザというかレンダリングエンジンというか...残念ながら正確に言い表す語彙を持っていないので、ふんわりとブラウザと表現しておきます

3つ目が本当に動くのであれば、それを実装する＆適当にブラウザや解像度のリストを作って実行すれば良いのでは？という発想です。

結果として割とあっさり動いたので、本記事は事実上そのコメントの動作検証および周辺コード整理の記事になっています。

なお成果物はこちらにあります:
https://github.com/cumet04/sbox_storyshots-playwright

:::message
本記事ではPlaywrightそのものやStorybook、Storyshots、Reactなどの詳細には触れません。そのあたりの前提はある程度知っていることを想定します。ただしPlaywrightについては「マルチブラウザ対応したpuppeteerみたいなやつ」程度の認識で問題ないですし、筆者もその程度の認識でやっています。
:::


## 前提環境を用意する
本記事は主に[Storyshots](https://storybook.js.org/addons/@storybook/addon-storyshots/)およびaddon-storyshots-puppeteerの話なので、まずそれらを動かす前提であるStorybookおよび素のStoryshotsの環境を用意します。

この環境に特にこだわりや条件は無いので、手っ取り早く`npx create-react-app hoge --template typescript`して`npx sb init`します。筆者の慣れのためにReact(CRA)とTypescriptにしましたが、ここは何でも良いです。ただし、StoryshotsはJestに乗っかって動くのでJestは必須です（この場合はCRAにJestが含まれているのでok）。

上記環境が出来上がったら最低限のStoryshotsをセットアップします。[アドオンのページ](https://storybook.js.org/addons/@storybook/addon-storyshots/)を参考にしつつ、
```
npm install -D @storybook/addon-storyshots
```
アドオンをインストールし

```typescript:src/Storyshots.test.ts
import initStoryshots from '@storybook/addon-storyshots';

initStoryshots();
```

を最低限配置します。

ここまでの前提環境で動作確認しておきたいのは
* `npm run storybook`（Storybookのdevサーバ）および `npm run build-storybook`（同静的ビルド）が動く
* `npm test`（JestおよびStoryshots）が動く

です。


## Playwrightでキャプチャしてみる
早速、本命の検証です。

まず、必要なパッケージをインストールします。やりたいことは「addon-storyshots-puppeteerにplaywrightをinjectする」なので、
```
npm install -D @storybook/addon-storyshots-puppeteer playwright
```
です。[addonのドキュメント](https://storybook.js.org/addons/@storybook/addon-storyshots-puppeteer)ではここで`playwright`ではなく`puppeteer`パッケージを入れるところですが、今回はpuppeteerは不要です。

なお、実行環境によっては`npx playwright install-deps`によってOSへの依存パッケージインストールが必要になります。必要な場合、playwrightを（このあとのtestを）実行した際に非常にわかりやすくエラーメッセージが出るため、それに従って実行すれば良いです。

:::message
なおOSへのパッケージインストールなのでsudoでやれなどと言われますが、事前に別途sudoを通しておけばsudoなし実行しても勝手にいい感じにしてくれます。
:::

:::message alert
playwrightパッケージのインストール時に、playwrightが使うためのブラウザの実行バイナリがダウンロードされます。これがなかなかに遅く、またnpmのinstallログには特に何も出ないため、ハングしてるように見えることがあります。
不安な方は`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`などと環境変数をセットして実行し、別途`npx playwright install`をすると良いです。
:::

そして[該当のissue](https://github.com/storybookjs/storybook/issues/10162#issuecomment-690423930)によると、`getCustomBrowser`オプション関数にplaywrightで起動したブラウザインスタンスを入れるだけで良いようなので、実際に書き下すと下記のようになります:

```typescript:src/Storyshots.test.ts
import initStoryshots from '@storybook/addon-storyshots';
import { imageSnapshot } from '@storybook/addon-storyshots-puppeteer';
import playwright from 'playwright'

initStoryshots({
  test: imageSnapshot({
    // MEMO: puppeteerパッケージが入っているとここで型エラーになる。
    // 違うモノを入れているので当然であるが、意図してやっているので必要なら@ts-ignoreで対処
    getCustomBrowser: () => {
      return playwright.chromium.launch()
    }
  })
});
```

では実行してみます。addon-storyshots-puppeteerのimageSnapshotは、デフォルトでは外部起動されたstorybookのdevサーバにアクセスする動作になるので、
```
npm run storybook
```
を起動しつつ、別ターミナルにて
```
npm test
```

として少々待つと

![snapshotが作成された](/images/storyshots-with-playwright/snapshot1.png)

`8 snapshots written.`とあり、できてそうな感じです。何やらwarningが出ていますが後で考えるとして

```
$ ls src/__image_snapshots__/
storyshots-test-ts-storyshots-example-button-large-1-snap.png
storyshots-test-ts-storyshots-example-button-primary-1-snap.png
storyshots-test-ts-storyshots-example-button-secondary-1-snap.png
storyshots-test-ts-storyshots-example-button-small-1-snap.png
storyshots-test-ts-storyshots-example-header-logged-in-1-snap.png
storyshots-test-ts-storyshots-example-header-logged-out-1-snap.png
storyshots-test-ts-storyshots-example-page-logged-in-1-snap.png
storyshots-test-ts-storyshots-example-page-logged-out-1-snap.png
```

それっぽいファイルが！試しに一番上の`button-large-1-snap.png`を開くと

![最初のキャプチャ](/images/storyshots-with-playwright/first-capture.png)

それっぽい！ターゲットは右上のちっさいやつなのに画像がデカいのがとてもブラウザキャプチャっぽい！  
※snapshotの画像をそのまま貼っており記事の背景色的に分かりづらいですが、気になる方は画像を別タブで開くと良いです

というわけで、そこそこすんなりとPlaywrightでStorybookのキャプチャが撮れました。ちなみに、コード中の`playwright.chormium`のところを`playwright.firefox`や`playwright.webkit`に変えれば、それだけでそれぞれの環境で実行できます。

元ネタのissueコメントを見たときは「そんな強引なｗ」と思いましたが、その割にはあっさりできました。やったね！


## 一旦足回りを整備する
Playwrightでキャプチャが撮れることが確認できたので、あとはブラウザ毎に実行したりデバイスサイズを想定したりとカスタムしていきたいところですが、その前にJestやStoryshotsの設定類を整備します。

まず、テスト実行時にStorybookのdevサーバを別起動するのが微妙なので、ビルド済Storybookを参照するようにします。これは[addonのドキュメント](https://storybook.js.org/addons/@storybook/addon-storyshots-puppeteer)にそのままの例があるので
```diff
 import initStoryshots from '@storybook/addon-storyshots';
 import { imageSnapshot } from '@storybook/addon-storyshots-puppeteer';
 import playwright from 'playwright'
+import path from 'path'

 initStoryshots({
   test: imageSnapshot({
+    storybookUrl: `file://${path.resolve(__dirname, '../storybook-static')}`,
     getCustomBrowser: () => {
       return playwright.chromium.launch()
     }
```
このように設定すれば、`npm run build-storybook`を事前に実行してその成果物を読んでテスト実行できます。

次に、テストがWatchモードで起動するのが（この場合は）使いにくいので止めます。package.jsonにて
```diff
   "scripts": {
     "start": "react-scripts start",
     "build": "react-scripts build",
-    "test": "react-scripts test",
+    "test": "react-scripts test --watchAll=false",
     "eject": "react-scripts eject",
     "storybook": "start-storybook -p 6006 -s public",
     "build-storybook": "build-storybook -s public"
```
と追記しておきます。とはいえこれはreact-scriptsの仕様なので、Jestを自前でセットアップしている場合は不要だと思います。


## ブラウザをちゃんと閉じる
前述のテストコマンドの結果スクショに出ているWarningなのですが、これは`getCustomBrowser`で渡したブラウザインスタンスをcloseしていないために起こっています。
ユーザ側が用意したブラウザインスタンスなので、ライブラリ (addon-storyshots-puppeteer) に頼らず自分でcloseする必要があります。というわけで

```diff
 import path from 'path'

+let browser: playwright.Browser;
+afterAll(() => {
+  return browser.close();
+});
+
 initStoryshots({
   test: imageSnapshot({
     storybookUrl: `file://${path.resolve(__dirname, '../storybook-static')}`,
-    getCustomBrowser: () => {
-      return playwright.chromium.launch()
+    getCustomBrowser: async () => {
+      browser = await playwright.chromium.launch()
+      return browser
     }
   })
 });
```

これでテスト終了時にブラウザがcloseされます。


## デバイス（サイズ）を指定する
ブラウザはいい感じになるので、あとはデバイス（画面サイズ）を指定したいです。Playwrightでは、ブラウザインスタンスからcontextというのを作ればそういう指定ができるようなので

```diff
 import initStoryshots from '@storybook/addon-storyshots';
 import { imageSnapshot } from '@storybook/addon-storyshots-puppeteer';
-import playwright from 'playwright'
+import { Browser, chromium, devices } from 'playwright'
 import path from 'path'

-let browser: playwright.Browser;
+
+let browser: Browser;
 afterAll(() => {
   return browser.close();
 });
@@ -13,8 +14,9 @@ initStoryshots({
     storybookUrl: `file://${path.resolve(__dirname, '../storybook-static')}`,
     getCustomBrowser: async () => {
-      browser = await playwright.chromium.launch()
-      return browser
+      browser = await chromium.launch()
+      const context = await browser.newContext(devices['Pixel 5'])
+      return context
     }
   })
 });
```

と、こんな感じで良いようです。これで実行すると、出力されるキャプチャがスマホっぽいサイズになります。

なおdevicesに指定できる文字列は、[定義のコード](https://github.com/microsoft/playwright/blob/v1.19.0/packages/playwright-core/types/types.d.ts#L15739)を見るのが良いです。
いい感じに型パズルして一覧を型として取り出せないかと思ったのですが、元の型に任意keyが入っているような感じだったので諦めました。


## 画像ファイル名をいい感じにする
これはStoryshotsやplaywrightではなく`jest-image-snapshot`の仕様なのですが、デフォルトで出力されるファイル名がこう...しんどいです。
ブラウザ・デバイスで複数パターン実施するための伏線も兼ねて、このファイル名をいい感じにします。

[コードを読んでみると](https://github.com/storybookjs/storybook/blob/v6.4.18/addons/storyshots/storyshots-puppeteer/src/imageSnapshot.ts)、`getMatchOptions`という関数の戻り値を`toMatchImageSnapshot`に渡しているようです。というわけで、両者のドキュメントやコードを見つつ

```diff
       browser = await chromium.launch()
       const context = await browser.newContext(devices['Pixel 5'])
       return context
-    }
+    },
+    getMatchOptions: (options) => {
+      const { kind, story } = options.context
+
+      const dir = path.resolve(__dirname, '__image_snapshots__', kind)
+      const name = story.replaceAll(/\s/g, '')
+
+      return {
+        customSnapshotsDir: path.resolve(dir),
+        customSnapshotIdentifier: name,
+      };
+    },
   })
 });
```

とこんな感じに作ります。すると

```
$ tree src/__image_snapshots__/
src/__image_snapshots__/
└── Example
    ├── Button
    │   ├── Large-snap.png
    │   ├── Primary-snap.png
    │   ├── Secondary-snap.png
    │   └── Small-snap.png
    ├── Header
    │   ├── LoggedIn-snap.png
    │   └── LoggedOut-snap.png
    └── Page
        ├── LoggedIn-snap.png
        └── LoggedOut-snap.png

4 directories, 8 files
```

となり、Storybookのサイドバーで見慣れた感じになります。


## いい感じに複数ブラウザ・デバイスしてみる
ここまでできれば、あとは検証したいブラウザとデバイスを並べればよさそうです。というわけで完成品がこちら。

```typescript
import initStoryshots from '@storybook/addon-storyshots';
import { imageSnapshot, Context } from '@storybook/addon-storyshots-puppeteer';
import { Browser, BrowserType, chromium, webkit, firefox, devices } from 'playwright'
import path from 'path'

// deviceName: refs https://github.com/microsoft/playwright/blob/v1.19.0/packages/playwright-core/types/types.d.ts#L15739
function initBrowserStoryshots(key: string, deviceName: string, browserType: BrowserType) {
  let browser: Browser;
  afterAll(() => {
    return browser.close();
  });

  // MEMO: puppeteerパッケージを入れているとここで型エラーになる
  const getCustomBrowser = async () => {
    browser = await browserType.launch()
    const context = await browser.newContext(devices[deviceName])
    return context
  }

  const getMatchOptions = (options: {context: Context, url: string}) => {
    const { kind, story } = options.context

    const dir = path.resolve(__dirname, '__image_snapshots__', key, kind)
    const name = story.replaceAll(/\s/g, '')

    return {
      customSnapshotsDir: path.resolve(dir),
      customSnapshotIdentifier: name,
    }
  }

  initStoryshots({
    test: imageSnapshot({
      storybookUrl: `file://${path.resolve(__dirname, '../storybook-static')}`,
      getCustomBrowser,
      getMatchOptions,
    })
  });
}

initBrowserStoryshots('Desktop-firefox', "Desktop Firefox", firefox)
initBrowserStoryshots('Pixel5-chrome', "Pixel 5", chromium)
initBrowserStoryshots('iPhone13-safari', "iPhone 13", webkit)
```

（全体成果物のリポジトリも再掲しておきます）
https://github.com/cumet04/sbox_storyshots-playwright

前節と変わっているのは
* 全体を関数でまとめ、識別子とデバイス名とブラウザタイプを指定できるようにした
* `getCustomBrowser`, `getMatchOptions`を変数定義した（インデント下げたいだけ）
* デバイスとブラウザをまとめた識別子を用意し、キャプチャの親ディレクトリにした

といったところです。あとは適当に3種類ほどテストを並べているので、実行すると

![24 snapshotsできてる](/images/storyshots-with-playwright/snapshot2.png)

3ケース分のテスト実行とキャプチャが出来上がりました。いい感じですね！


## まとめ
あとは好きなようにデバイスとブラウザを並べて実行し、リグレッションテストをするなり[ホスティング環境にアップしてサッと眺める](https://zenn.dev/cumet04/articles/private-storybook-on-pullreq)なりして便利に使えそうです。

少々公式感が無いこと・Playwrightの`npm install`が遅いのがCIなどの観点で懸念ですが、それ以外は追加コードも少なく内容の割には導入しやすい印象です。

このユースケース気になってた方やカジュアルに試してみたい方など、参考になれば。
