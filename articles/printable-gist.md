---
title: "印刷readyなgistを作る小技"
emoji: "✨"
type: "idea" # tech: 技術記事 / idea: アイデア
topics: [gist, 小ネタ, 印刷]
published: false
---

:::message
この記事は2020年8月26日にqiitaに投稿したものの移行記事となります。
元記事はこちら https://qiita.com/cumet04/items/1055517fe3011f349766
:::

ちょっと整形した感じのドキュメントを書いてpdfや紙にしたい。
markdownを印刷するような記事を探すと、やれnpmツールだpandocだとめんどくさい。
githubのりどみを印刷するだけみたいな、そのくらいの軽さでいい。

そういうわけで、gistを作って印刷するための小技です。

## コンテンツ以外の部分を消す
普通にgistを作るとこんな感じです。

![ss1](https://storage.googleapis.com/zenn-user-upload/1dodbhalf4efu24ool3fxcd8nlhp)

ヘッダとかコメント欄とかが邪魔です。

というわけでコンテンツ以外の部分を消しましょう。おもむろにブラウザのdevtoolのconsoleを開き、

```javascript
const body = document.querySelector('.Box-body.readme')
document.body.innerText = ""
document.body.appendChild(body)
```

これを突っ込みます。

![ss2](https://storage.googleapis.com/zenn-user-upload/ud48466hhctebuv6ol39nkv6p0gs)

スッキリですね。

## 改行位置を調整する
本格的にドキュメントを書いていき、ふと印刷プレビューを見るとこんな感じでした。

![ss3](https://storage.googleapis.com/zenn-user-upload/gs5ghftp10yn5oe5w4f8jun7zytq)

そこで切られるのはちょっと...

区切りを入れたい位置を確認したらやはりdevtoolを開き、改行したい位置のDOMのstyleに

```css
page-break-after: always;
```

もしくは

```css
page-break-before: always;
```

を入れます（改行前後どちらのDOMに入れるかで調整してください）。

![ss4](https://storage.googleapis.com/zenn-user-upload/9k86o9uqzh1tj31ezq6i6lw7ehhg)

いい感じですね。

気が済んだら印刷しましょう。

#### 補足
記事執筆の数ヶ月前までは、改行したい位置にmarkdown上で

```html
<hr style="page-break-after: always;">
```

を入れていたのですが、いつの頃からかこれでは動かなくなっていました（style属性が消される）。
印刷のたびに手動で頑張らないといけなくなったので面倒ですが、どうせコンテンツ編集のたびに調整が必要と思えば手間は同じかもしれません。

## まとめ
もう「○○をpdfで提出してください」とか言われても平気ですね。
