---
title: "zennでも限定公開がしたい！"
emoji: "📝"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [zenn netlify 記事]
published: true
---

この記事は [LITALICO Engineers Advent Calendar 2021](https://qiita.com/advent-calendar/2021/litalico) その2 の15日目の記事です。

たまーにですが、ありますよね。限定公開したいとき。

Qiitaの限定公開を思うと、要するにrenderされた記事がなんらか外部から予測できないURLに置いてあるだけですよね。

なんか作れそうだな？となりますし、作ってみたくなっちゃいますよね。えんじにあだもの。

## 番外編: 作らずに実現する
エンジニアたるもの、時にはコードを書かずに問題解決することも重要です。

既存の道具だけで似たようなことをやる手段として、「自分用プレビューをpdf印刷する」という手があります。

CLIのプレビューもしくは非公開で同期した際のプレビューページにて、ブラウザの印刷メニューからpdfに吐き出します。出来たら、見せたい人にファイルを送りましょう。

## アイデア
ここからはエンジニアらしく、モノを作っていきましょう。

なんらか記事のmarkdownからhtmlを吐き出すことができれば、netlifyなどの環境に適当な名前でデプロイすればよさそうです。

ブランチに対してCI的に自動実行され、未公開状態の記事のプレビューが生成されるといい感じです。出来上がったらURLを共有するだけ。

:::message
成果物は下記のリポジトリにある `preview.js` と `package.json` を見れば、それがほぼ全てです。手っ取り早く使いまわしたい方はこちらをどうぞ。
https://github.com/cumet04/zenn-docs
:::

## 1. htmlを生み出す
まずは何かしらhtmlを吐き出してみます。何か情報あるかな、と思いzenn-cliのあるリポジトリを見ると
https://github.com/zenn-dev/zenn-editor/#use-on-your-website
はい。完全にそのまま欲しいパッケージとコードが書いてあります。では手元でちょろっと書いてみます。

```javascript
const fs = require("fs");
const markdownToHtml = require("zenn-markdown-html");

const filepath = "./articles/zenn-private-preview.md";
const raw = fs.readFileSync(filepath, { encoding: "utf-8" });
const html = markdownToHtml.default(raw);
fs.writeFileSync("out.html", html);
```

適当に実行し、ブラウザで開いてみます。

![とりあえず出力したhtml](https://storage.googleapis.com/zenn-user-upload/ecf19d2e7678-20211214.png)

CSSは設定してないので当然として、メタ情報がそのまま入ってます。ちなみに出力されるのはhtmlタグやbodyタグの無い中身だけです。

ということは、メタ情報をparseし、タイトルや外枠などのガワを作り、CSSを当てれば良さそうです。


## 2. ガワを用意する
CSSは前述のリポジトリのREADME通りに当てれば良いし、外枠などのガワは適当にhtmlを書けば良いとして、メタ情報をいい感じにする必要があります。

なんかやり方あるかなとzenn-cli周りのコードを追いかけていくと

https://github.com/zenn-dev/zenn-editor/blob/v0.1.99/packages/zenn-cli/src/server/lib/articles.ts#L60

なんかライブラリを使ってますね。

https://www.npmjs.com/package/gray-matter

なるほど。

これも使いつつ、メタ情報とガワとCSSを用意してみます。

```javascript
const fs = require("fs");
const path = require("path");
const markdownToHtml = require("zenn-markdown-html");
const matter = require("gray-matter");

function buildArticle(filename) {
  const filepath = path.relative(__dirname, filename);
  const raw = fs.readFileSync(filepath, { encoding: "utf-8" });
  const {
    data: { title },
    content,
  } = matter(raw);

  const article = markdownToHtml.default(content);

  const html = `
<html>
<head>
  <link rel="stylesheet" href="./zenn-content-css.css" />
  <style>
    body {
      background-color: #edf2f7;
    }
    header {
      margin-top: 50px;
      height: 100px;
      display: grid;
      place-items: center;
    }
    article {
      max-width: 790px;
      padding: 40px;
      margin: 0 auto;
      border-radius: 12px;
      background-color: white;
    }
  </style>
</head>

<body>
  <header>
    <h1 class="title">${title}</h1>
  </header>
  <main>
    <article class="znc">${article}</article>
  </main>
</body>
</html>
  `;

  fs.writeFileSync("./preview/out.html", html);
}

const filepath = "./articles/zenn-private-preview.md";
fs.copyFileSync(
  "./node_modules/zenn-content-css/lib/index.css",
  "./preview/zenn-content-css.css"
);
buildArticle(filepath);
```

今回は思いついたまま動くものをサクッと作り上げる気持ちなので、、Reactやモジュールバンドラなどは使わず、ただのjavascriptのスクリプトです。htmlも文字列。cssもnode_modulesからそのままコピーしてます。

ちなみにガワのstyleはzennのサイトを見ながら少々頂いてきました。

![ガワ付き](https://storage.googleapis.com/zenn-user-upload/5950afea9bf1-20211214.png)

いい感じですね。

ここから、未公開分だけ選んでビルドする & 念の為noindexタグを付与したものが下記になります。URLとしては推測されにくいものになる想定ですが、念の為にnoindexも設定しておきます。

https://github.com/cumet04/zenn-docs/blob/daf7d88a43ff5c63a9fccf15a4ee20b4ad047346/preview.js

<!-- TODO: ハッシュをmerge後に差し替える。この時点だとnoindexついてない -->

この後のステップはこのコードが前提です。

:::message
なお、この状態ではTweetなどの埋め込みコンテンツが表示されません。それを実現するための`zenn-embed-elements`は単独ファイルではなくモジュールバンドラが必須に見えたため、今回は対応を見送りました。
:::


## 3. netlifyに上げてみる
後は適当なホスティングサービスに投げればokです。ここではnetlifyを使います。

https://www.netlify.com/

選定理由は
* 筆者が前に触ったことがあり、簡単（連携したら勝手にいい感じになる）なことを知っていた
* ブランチに対し、なんらかハッシュっぽいURLのプレビューページが生成できる

です。特に後者は自前でランダムURLを生成しなくて良いので楽です。

ということでnetlifyに登録し、リポジトリを登録していきます。ログイン後のトップから

![リポジトリ追加](https://storage.googleapis.com/zenn-user-upload/894e20405eee-20211214.png)

ここからポチポチ追加していきます。

途中、ビルドコマンドやデプロイ対象ディレクトリを指定する欄があるので、それぞれ入力します。コマンドはpackage.jsonのscriptsに`"build:preview": "node preview.js"`と入れておき、`npm run build:preview`としました。ディレクトリは本記事のスクリプトでは`preview`になっています。

このほぼデフォルトの時点でもmainブランチとPull Requestに対してビルドが実行されるのですが、本件は限定公開が条件なので、そのあたりの設定を調整していきます。項目は以下。

![デプロイ設定](https://storage.googleapis.com/zenn-user-upload/ce78acfda01b-20211214.png)

ポイントは
* `Deploy log visibility`: ログにビルドID（実質のプレビューのドメイン）が出るため、他の人から見えないようにする
* `Branch deploys`: 作業中のブランチをビルドしてほしいので、全ブランチを対象にする
* `Deploy Previews`: pullreq番号から推測できるドメインのプレビューが生成される & pullreqにURLが載っちゃうので止める。Branch deploysだけで良い。

また、下記でmainに対するデプロイも止めておきます。これは特にIDなどつかない通常のドメインなので、普通に予測可能なURLになります。
![公開設定](https://storage.googleapis.com/zenn-user-upload/0fc77f4d6b7b-20211214.png)

ここまでやっておけば、ドラフトな記事ファイルを含んだブランチをpushすると、いい感じにプレビューが生成されます。

## 4. プレビューを確認する
netlifyの管理画面から `Builds` を見ると、pushしたブランチに対してビルドが実行されているかと思います。`Branch Deploy`とラベルがついているはず。

こいつの詳細ページに行き、Previewボタンを押します。トップページは用意していないのでNot Foundになっていますが、ここでビルドされているはずの`preview`以下のファイルパスを直接入力すると

![デプロイされたプレビュー](https://storage.googleapis.com/zenn-user-upload/cd6eb6c51533-20211214.png)

いい感じに見えています。ドメインも何やら長い文字列になっているのが確認できます。

あとは、このURLを見てほしい人に共有すれば、無事限定公開ができますね！

筆者はzennの記事を公開リポジトリで管理しているのでpushした時点で秘匿不可能ですが、privateリポジトリにしている方ならこれでだいたい大丈夫なのではないでしょうか。

:::message
netlifyで作成されたプレビューはどうも[削除されない/できない](https://answers.netlify.com/t/delete-deploy-previews-with-sensitive-data/28773)ようです。なんかあったら一旦サイトごと消せとのこと。
上のスクショにあるURLも、頑張って入力すれば見えるはずです。
:::



## まとめ
あまり頻繁に需要があるわけではないと思いますが、いざ限定公開したくなった時にサッと出せると良いですね。

参考になれば。
