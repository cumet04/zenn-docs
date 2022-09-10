---
title: "RuboCopのServer Modeで高速lint/formatする with Docker"
emoji: "📚"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [ruby, docker, rubocop, vscode, rails]
published: false
---

以前、[rubocop-daemon](https://github.com/fohte/rubocop-daemon)をDocker環境で動かしてvscodeで高速にformat on saveする記事を書きました。
https://zenn.dev/cumet04/articles/fast-rubocop-on-docker

この記事ではサードパーティのライブラリのfork + 自前のクライアントスクリプトで実現していましたが、2022年6月末にリリースされた[RuboCop 1.31](https://github.com/rubocop/rubocop/releases/tag/v1.31.0)より、同じことを実現するServer Modeが公式に実装されたようです。
https://docs.rubocop.org/rubocop/usage/server.html

というわけで、こちらでも同様にDocker環境 + vscodeで動かしてみました。

## 挙動や仕様を探ってみる
まずはServer Modeを軽く動かしてみて挙動や仕様を確認してみます。

:::message
以下、最終成果とは直接関連が薄い動作検証セクションとなります。手っ取り早く組み込む方法だけ知りたい方は[vscodeに組み込む](#vscodeに組み込む)セクションをご覧ください
:::

最低限rubocopが動くRuby on Dockerな開発環境を作り、そこで動作確認をしたあとにvscodeに組み込んでいく想定です。
なお完成品のリポジトリがこちら。sinatraのサンプルコードにrubocopを入れただけとなっています。

https://github.com/cumet04/sbox_rubocop-server-on-docker

### 通常のユースケースを試す
まずはコンテナの中に入り、コンテナ/ホストを意識しない通常のユースケースで動かしてみます。

ドキュメントによると`--server`オプションをつけてrubocopを実行すると、サーバプロセスが起動していなければ起動し、既にサーバがあればそれを使って実行するというような挙動になるようです。
ということで、serverなし・serverあり（一回目）・serverあり（二回目）の3パターンをtimeコマンドで時間を見ながら実行します。

```shell:アプリケーションコンテナの中にbashで入った
root@b6d6d4555a18:/app# time rubocop .
Inspecting 2 files
..

2 files inspected, no offenses detected

real    0m0.677s
user    0m0.617s
sys     0m0.132s
root@b6d6d4555a18:/app# time rubocop --server
RuboCop server starting on 127.0.0.1:46801.
Inspecting 2 files
..

2 files inspected, no offenses detected

real    0m0.645s
user    0m0.616s
sys     0m0.102s
root@b6d6d4555a18:/app# time rubocop --server
Inspecting 2 files
..

2 files inspected, no offenses detected

real    0m0.242s
user    0m0.059s
sys     0m0.019s
```

realだけ取り出してサマリすると以下となります。
* serverなし: 0.677s
* serverあり(1): 0.645s
* serverあり(2): 0.242s

`serverあり(2)`が早くなっており、想定通りの挙動をしているように見えます。今回は実験環境が非常にミニマルなためserverなしでもそこまで遅くありませんが、実際のプロジェクトではより遅いはずなので、serverありで得られる恩恵はより大きいでしょう。

:::message
原理的にServer Modeによって起動オーバーヘッドを減らせば高速になるはずだということはわかっており、本記事ではこの速度差については特に掘り下げません。
そのため、現実に近い大規模なプロジェクトを用意したり複数回実行して平均を取るようなベンチマークは実施せず、上記の簡易的な確認に留めています。
:::

### コンテナ外からの実行を考える
以前書いた記事ではrubocopのdaemonをコンテナとして常時起動し、それに対してホストマシンからシンクライアント的にコマンドを実行するという仕組みにしていました。そのため、Server Modeでも似た仕組みを想定して試してみます。

ドキュメントによると`--start-server`や`--stop-server`オプションでサーバの起動や停止だけを実行できるようなので、試してみます。

```shell:コンテナ内bash
root@b6d6d4555a18:/app# rubocop --start-server
RuboCop server starting on 127.0.0.1:41393.
root@b6d6d4555a18:/app# rubocop --start-server
RuboCop server (27) is already running.
root@b6d6d4555a18:/app# rubocop --stop-server
root@b6d6d4555a18:/app# rubocop --start-server
RuboCop server starting on 127.0.0.1:42167.
```

デフォルトではポート番号は特に固定されておらず、起動ごとに変更されるようです。ここは`$RUBOCOP_SERVER_HOST`や`$RUBOCOP_SERVER_PORT`環境変数で指定できるとドキュメントに記載されています。

また`--start-server`はサーバプロセスを起動してすぐ終了する仕様で、ドキュメントを見てもサーバをforegroundで起動するようなオプションは見当たりませんでした。

ともあれ、適当なポートをホストにbindしたコンテナでサーバを実行し、ホスト側からそこに繋いでrubocopしてみます。
`docker-compose.yml`に以下のようなサービスを追加し、
```yml:docker-compose.yml
  rubocop-server:
    ...
    command: bash -c 'rubocop --start-server; sleep infinity'
    environment:
      RUBOCOP_SERVER_HOST: 0.0.0.0
      RUBOCOP_SERVER_PORT: 45678
    ports:
      - 45678:45678
```

これを起動した状態でホスト側で`env RUBOCOP_SERVER_HOST=localhost RUBOCOP_SERVER_PORT=45678 rubocop --server`と実行すると
```
Address already in use - bind(2) for "localhost" port 45678 (Errno::EADDRINUSE)
```

新しくサーバを起動しようとしてしまいました。どうも別ホストに明示的に起動したサーバに接続しにいくようなユースケースは想定されていないようです。

:::details コードからこの挙動を追ってみた記録
念のため、rubocop本体のコードを確認して上記仕様を確かめてみます。

まずエントリーポイント的なファイルの該当コードがこれです。
https://github.com/rubocop/rubocop/blob/d5d2fe1b37624b43b055507e3e1329f747e7812d/exe/rubocop#L11-L12

ここから、`RuboCop::Server.running?`の定義を追ってみると、下記のようになっていました。
https://github.com/rubocop/rubocop/blob/d5d2fe1b37624b43b055507e3e1329f747e7812d/lib/rubocop/server.rb#L33-L37

これ以上は掘り下げていませんが、見るからにキャッシュ（ファイルシステムと思われる）やpidを参照しており、あくまでサーバもクライアントも同一ホストで動作させる想定になっているようです。
:::

仕方ないのでこの方針は諦めます。そこで通常のユースケースに則り、アプリケーションコンテナに対して`docker compose exec`で`rubocop --server`を実行してみます。

```shell:ホストマシン上
sbox_rubocop-server-on-docker$ time docker compose exec app rubocop --server
RuboCop server starting on 127.0.0.1:34289.
Inspecting 2 files
..

2 files inspected, no offenses detected

real    0m0.873s
user    0m0.039s
sys     0m0.030s
sbox_rubocop-server-on-docker$ time docker compose exec app rubocop --server
Inspecting 2 files
..

2 files inspected, no offenses detected

real    0m0.238s
user    0m0.043s
sys     0m0.026s
```

2回目が早くなっており、単にこれを実行させれば良さそうということがわかります。
こちらのほうがシンプルに実現できそうであり、そもそも他の方法は無いことから、この方向で進めます。

## vscodeに組み込む
Server Modeの挙動や仕様とDocker環境での実現方針は決まったので、vscode上で動かせるように設定していきます。
なおvscodeを想定していますが、用意するラッパースクリプトは汎用なので、vscode以外でも使えるはずです。

まず環境準備ですが、cop対象のコードがあるコンテナがdocker-composeで動作しており、そのプロジェクト内にあるrubocopが`1.31`以上のバージョンになっていればokです。特に追加のライブラリやコンテナ設定などは不要です。

次にホスト環境で`rubocop`コマンドとして振る舞うラッパースクリプトを用意します。ここでは`bin/rubocop`として下記のようなスクリプトを作成します。

```bash:bin/rubocop
#!/bin/bash

cd $(dirname $0)/.. # docker-compose.ymlがあるディレクトリに移動

OPTION=$(test -p /dev/stdin && echo '-T') # 標準入力を受ける場合もそうでない場合もいい感じに動くよう、`-T`オプションの有無を制御
docker compose exec $OPTION app rubocop --server $@ # --serverオプションを入れつつ、他の引数をそのまま渡す
```

これで`bin/rubocop`が実質コンテナ内でのrubocopコマンドとして動作します。ただしファイルパスはコンテナ内のWORKDIR基準なので注意が必要です。

最後にvscode用に拡張と設定を用意します。
rubocopを動作させる拡張として[`misogi.ruby-rubocop`](https://marketplace.visualstudio.com/items?itemName=misogi.ruby-rubocop)を導入し、また下記設定を追加します。

```json:settings.json
  "ruby.rubocop.executePath": "./bin/",
  // formatはせずlintだけでよいなら下記設定は不要
  "[ruby]": {
    "editor.defaultFormatter": "misogi.ruby-rubocop"
  },
```

ここまでできれば、Server Modeなrubocopがいい感じにlintやformatを実行してくれるようになります。

:::message
ここで用意したラッパースクリプトを使う場合、[`rebornix.Ruby`](https://marketplace.visualstudio.com/items?itemName=rebornix.Ruby)拡張のformatter/linter設定は下記の理由により動作せず、上記拡張を使う必要があります。

* rubocopに渡すファイルパスをホスト上の絶対パスで渡してしまい、コンテナ内のパスと食い違う
  - `misogi.ruby-rubocop`は相対パスで渡すので問題ない
* formatterのカスタムパスを指定できず、カスタムの`bin/rubocop`を指定できない
:::

## まとめ
RuboCopが公式にServer Modeを実装したことにより、高速なlintやformatがかなり簡単に導入できるようになりました。

これまでの環境への変更が多い手順に抵抗があった方も、これを機に導入してみてはいかがでしょうか。
