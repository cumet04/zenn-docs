---
title: "既存TypeScriptプロジェクトを少しずつstrictにする"
emoji: "🕌"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [typescript]
published: true
---

:::message
この記事は『[LITALICO Engineers Advent Calendar 2020](https://qiita.com/advent-calendar/2020/litalico)』18日目の記事です。遅れておりました。
:::

> `Uncaught TypeError: Cannot read property 'name' of undefined`

ん？そんなAPI戻り値とかのデータを雑に丸めたりしてないけどな。
ってあれ？これ変数`| undefined`になってるやんけ！にエラーとか出とらんから対処しとらんかったぞ！tsc仕事してんのか！？

だって`tsconfig.json`に...
```json:tsconfig.json
{
  "compilerOptions": {
    ...
    // "strict": true, // TODO: ちょくちょくONにして直してくれるとうれしい
```

...うん。そっか。そうやな...

いや！望みを託されてONにしたろ！

```
$ yarn dev
...
ERROR in /home/user/repos/github.com/awesome_org/big-project/frontend/src/xxx/aaa.tsx
./src/xxx/aaa.tsx
[tsl] ERROR in /home/user/repos/github.com/awesome_org/big-project/frontend/src/xxx/aaa.tsx(14,43)
      TS2531: Object is possibly 'null'.

ERROR in /home/user/repos/github.com/awesome_org/big-project/frontend/src/xxx/bbb.tsx
./src/xxx/bbb.tsx
[tsl] ERROR in /home/user/repos/github.com/awesome_org/big-project/frontend/src/xxx/bbb.tsx(92,73)
      TS2322: Type 'string | undefined' is not assignable to type 'string'.
  Type 'undefined' is not assignable to type 'string'.

ERROR in /home/user/repos/github.com/awesome_org/big-project/frontend/src/xxx/ccc.tsx
./src/xxx/ccc.tsx
[tsl] ERROR in /home/user/repos/github.com/awesome_org/big-project/frontend/src/xxx/ccc.tsx(103,68)
      TS2345: Argument of type 'Date | null' is not assignable to parameter of type 'Date'.
  Type 'null' is not assignable to type 'Date'.
...
```

まぁそうですよねー。知ってたー。

## いま書いたコードだけでも...
しかしビルドができないとなると、ちょくちょくONにすることすらできません。とはいえこのままだとプロジェクトのstrictへの道は永遠に閉ざされたままです。
そこで、せめて書いてる最中のコードだけでもstrictにすることにします。

すなわち、エディタ上でだけエラーにするようにします。

### tsconfig.jsonを直す
開発メンバーは皆vscodeを使っているため、tsconfig.json設定をstrictにしておけばひとまずエディタ上でエラーになります。

```diff:tsconfig.json
{
  "compilerOptions": {
    ...
-    // "strict": true, // TODO: ちょくちょくONにして直してくれるとうれしい
+    "strict": true, // webpackではfalseで上書きしてるので注意（エディタ上では有効）
```

### webpack上でstrictしないようにする
このままでは当然エラーの嵐に見舞われるため、ビルド時にはstrictチェックをしないようにします。
上記jsonのコメントにもあるようにwebpack上ではfalseにします。

```javascript:webpack.config.js
...
module: {
  rules: [
    {
      test: /\.(ts|tsx)$/,
      use: {
        loader: 'ts-loader',
        options: {
          compilerOptions: {
            // tsconfig上はtrueにしてエディタ上ではstrictチェックを入れ、
            // ビルド上では無効化することで無関係なファイルでエラーしないようにする
            strict: false,
          },
          ...
```

ts-loaderのoptionsで`compilerOptions.strict`を明示的にfalseに上書きします。

:::message
テストフレームワークなどwebpack以外にもtsconfigを読むものがあればそちらも同様に設定する必要があります
:::

これでエディタ上ではエラーに沿って粛々とstrict対応をしつつ、既存の別のコードのビルドでは従来どおりのチェックで見逃してもらうことができます。

また`tsconfig.json`も同様ですが、きちんとコメントを添えておきましょう。
コメントが無いと、将来のメンバーが「`strict: false`！？けしからん！消し去ってくれる！」といらぬ心労を抱えてしまいます。

## まとめ
こうして、全然strictじゃない既存プロジェクトがstrictへの道を歩み始めました。

諦めずに少しずつでも良くしようとする心持ちが大事なのです。
