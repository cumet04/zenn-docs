---
title: "Ruby on Docker環境で高速にrubocopする"
emoji: "📚"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [ruby, docker, rubocop, vscode, rails]
published: true
---

数年前にgo/gofmtに触れて以降、CodeFormat on Saveされないとソワソワする体質になってしまい、仕事のRails開発においても`"ruby.format": "rubocop"`してFormat on Saveしています。  
しかしながらrubocopは起動が遅く、Ctrl+SしてからFormat & Saveされるまでに1~2秒かかってしまい大変ストレスフル...

そこでrubocop実行を高速に、またDocker環境で満足に動くように試みました。

## 2022/9/10 追記
RuboCop 1.31 にて正式にServer Mode機能が実装されたため、そちらを使ったよりシンプルな方法を新しく記事にしています。

https://zenn.dev/cumet04/articles/rubocop-server-with-docker

:::message alert
これ以下の内容は過去の記録として一応残していますが、内容が古くこの方法に特にメリットは無いと考えているため、筆者としてはより公式な方法である上記記事の方法を推奨します
:::

---

:::message
2021/1/9 vscodeでの利用についてスマートな方法に更新しました
:::

## TL;DR
既存プロジェクトのdocker-composeに[rubocop-daemon](https://github.com/fohte/rubocop-daemon)を追加し、そこにローカルからコマンドを送信してrubocopとして動かせる環境を作った。

rubocop-daemon本体のforkおよび機能追加、composeの設定、環境特化のwrapperスクリプト（`rubocop`として動くもの）を作り、vscodeからformatterとして実行できる環境を記した。

成果物と試行錯誤ログはこちら
https://github.com/cumet04/sbox_rubocop-daemon-on-docker/tree/rubocop-daemon-gem
https://zenn.dev/cumet04/scraps/fae984bf1de5e5

なお本記事は調査・試行錯誤ログの割合が多いため、手っ取り早く導入だけしたい方は上記リポジトリより`README.md`, `docker-compose.yml`, `backend/bin/rubocop`だけ読めばokです。

:::message
以降、記載するコードは抜粋のみのため、必要に応じて上記リポジトリを参照してください。
:::

## rubocop-daemon
https://github.com/fohte/rubocop-daemon

rubocopをrequireしたdaemonを起動しておき、実際のCLIはdaemonへのコマンド送信と結果受信のみ行う（処理はdaemonが実行する）というツールです。都度の実行時に起動オーバーヘッドが発生せず早い、という仕組みです。

これや！求めていたのはこれや！こいつをdocker-composeで動かせばええんや！

...と思ったのですが、これはdocker環境というよりは1ホストに複数立てていい感じに使えるような想定の実装のため、docker環境で動かすには一工夫いりそうです。

## とりあえず動かしてみる
とはいえ、まずは最低限動く状態にしてみます。

:::message
本記事での導入対象の想定は「docker-composeな開発環境のRailsプロジェクト」とします。
ただしRails特有の要素に依存する要素は無いため、Dockerを使っているRuby開発であれば何でも導入できるはずです。
:::

プロジェクトのディレクトリ構成は以下のような想定です。
```
/project-root/
  docker-compose.yml
  backend/
    Dockerfile
    Gemfile
    other-ruby-project-files...
```

またDockerfileも以下のようなシンプルなものの想定です。
```dockerfile
FROM ruby:2.7.2

WORKDIR /app
COPY Gemfile Gemfile.lock ./
RUN bundle install
COPY . /app
```

この環境にrubocop-daemonを追加します。
Gemfileに以下を追加し、
```ruby:Gemfile
gem 'rubocop-daemon', require: false
```

docker-compose.ymlに
```yml:docker-compose.yml
  rubocop_daemon:
    build:
      context: ./backend
    command: bundle exec rubocop-daemon start --no-daemon
    volumes:
      - /app/.bundle
```
という感じでrubocop-daemonのサービスを追加し`docker-compose up`すると、アプリケーションとは別にrubocop-daemonのコンテナが起動します。

この状態でrubocop-daemonのコンテナ内で`rubocop-daemon exec`すれば、つまり`docker-compose exec rubocop_daemon bundle exec rubocop-daemon exec`すればrubocopした場合の結果が出力されます。

簡単にですが、「ひとまず動く」状態を作ることができました。
ただしこれでは`docker-compose exec`と`bundle exec rubocop-daemon`それぞれの起動オーバーヘッドが発生し、下手するとrubocopをそのまま動かすより遅くなってしまいます。

ここはやはり[より速く](https://github.com/fohte/rubocop-daemon#more-speed)、rubocop-daemonのリポジトリにある`rubocop-daemon-wrapper`をローカル実行できるようにしたいところです。

:::message
ここまでは動作確認のみのため`rubocop_daemon`コンテナにローカルのソースコードをマウントしていませんが、もしこのまま利用するのであればvolumesに追加しておく必要があります。
:::

## wrapperを読み解く
そのためにはwrapperが何をしているのか確認します。
なお記事投稿時点での該当コードは[こちら](https://github.com/fohte/rubocop-daemon/blob/v0.3.2/bin/rubocop-daemon-wrapper)です。

上から要約すると
- `rubocop-daemon`が使えない場合に標準rubocopにfallback (L5-14)
- OS/ディストリによる`nc`コマンドのオプション分岐 (L16-42)
- daemonの各種ステータスのディレクトリ・ファイル名取得 (L44-66)
- コマンド実行の排他制御 (L68-88) refs [issue](https://github.com/fohte/rubocop-daemon/issues/12)
- 標準入力の読み取り（`-s` `--stdin`付きの場合） (L90-97)
- daemonに送るコマンドの組み立て・送信 (L103-117)
- 失敗時のクリーンアップ（コマンド送信自体に失敗した場合） (L119-132)

となっています。

ここから、docker-composeで動かすにあたってのポイントは
- daemonとは`nc`コマンドを使って、つまりTCPで通信しており、トークン・実行コマンド・標準入力の内容を送信している
- daemonの状態を所定のディレクトリから読み取る必要がある
- rubocop実行の終了コードはstatusファイルに書き込まれる

となります。

## daemonをcomposeで動かす
これらを踏まえると、docker-composeの設定では「daemonのTCPポートをホストに露出する」「状態のディレクトリをホスト側から上書きマウントする」ことができればよさそうです。

### rubocop-daemonの待ち受けポートを外部に露出する
と、ここで[rubocop-daemonのコード](https://github.com/fohte/rubocop-daemon/blob/v0.3.2/lib/rubocop/daemon/server.rb#L37)を見ると、TCP待ち受けのアドレスが`'127.0.0.1'`で固定になっています。これではコンテナの外からの通信を受け付けることはできません...

ということで、forkしてbindingオプションを追加したものがこちら。
https://github.com/cumet04/rubocop-daemon/tree/binding_option

`rubocop-daemon start`に`--binding 0.0.0.0`とオプションを追加するとコンテナの外からの通信を受けることができます。

現在はこれを使う必要があるため、Gemfileを以下のように変更します。
```diff:Gemfile
-gem 'rubocop-daemon', require: false
+gem 'rubocop-daemon', git: 'https://github.com/cumet04/rubocop-daemon', branch: 'binding_option', require: false
```

:::message
この変更は[本家にpull-reqeustを出しており](https://github.com/fohte/rubocop-daemon/pull/26)、もしこれがmergeされればこのセクションの内容はまるっと不要になります。なるといいなぁ。
:::

### docker-compose.ymlを修正する
ホストとのTCP通信・状態ファイルの読み取りをできるように変更したdocker-compose.ymlが以下です。

```diff:docker-compose.yml
  rubocop_daemon:
    build:
      context: ./backend
-    command: bundle exec rubocop-daemon start --no-daemon
+    command: bundle exec rubocop-daemon start --no-daemon --binding 0.0.0.0 --port 3001
    volumes:
+      - "./backend/tmp/rubocop-daemon:/root/.cache/rubocop-daemon/app"
      - /app/.bundle
+    ports:
+      - "3001:3001"
```

※volumesの`/root/.cache/rubocop-daemon/app`の最後の`/app`はコンテナ内でdaemonが動くディレクトリに合わせます

これでdockerホスト側の3001ポート経由でrubocop-daemonとTCP通信ができ、状態ファイルも`./backend/tmp/rubocop-daemon`から参照できます。


## wrapperスクリプトを書く
daemon側の準備ができたので、クライアント側の準備をします。

利用の前提やファイルパスなどの差異のためオリジナルの`rubocop-daemon-wrapper`は使えないため、この環境特化で作ります。また~~分岐とかやるのが面倒なので~~vscodeのformatterとしてのみ使うことに最適化します。

```bash:backend/bin/rubocop
#!/bin/bash

set -eu
cd $(dirname $0)/..

NETCAT="nc" # 環境に応じて調整
DAEMON_DIR="tmp/rubocop-daemon"

COMMAND="$(cat $DAEMON_DIR/token) /app exec $@"

# 標準入力を読み取っておく; vscodeは'-s'オプション付きで実行するため
STDIN_CONTENT="$(cat)"

printf '%s\n%s\n' "$COMMAND" "$STDIN_CONTENT" | $NETCAT 127.0.0.1 $(cat $DAEMON_DIR/port)

exit $(cat $DAEMON_DIR/status)

```

決め打ちに決め打ちを重ね、更にエラー処理を略すことで非常にシンプルになっています。

`nc`コマンドはコードを直接書き換える式を採りました。Linuxな方は`nc -N`にしてgit excludeしておきます。環境変数で上書きできるようにしたかったのですが、vscodeから実行した際にうまく読み込んでくれなかったため諦めました。

それ以降の処理はオリジナルを参考にシンプルにしたものです。
`-s`オプションは指定されていると決め打ちです。またエラー処理も`set -e`に任せています。プロジェクト内で使うものならこのくらいでもよいでしょう。

この時点で、以下のように上記ファイルを`-s`オプション専用のrubocopコマンドとして利用可能です。`nc`コマンドを使った簡易なスクリプトのため動作も速いです。
```
backend> cat config/application.rb | ./bin/rubocop -s config/application.rb
Inspecting 1 file
C

Offenses:

config/application.rb:1:1: C: [Correctable] Style/FrozenStringLiteralComment: Missing frozen string literal comment.
require_relative "boot"
^
config/application.rb:1:18: C: [Correctable] Style/StringLiterals: Prefer single-quoted strings when you don't need string interpolation or special symbols.
require_relative "boot"
                 ^^^^^^
config/application.rb:3:9: C: [Correctable] Style/StringLiterals: Prefer single-quoted strings when you don't need string interpolation or special symbols.
require "rails/all"
        ^^^^^^^^^^^
config/application.rb:10:3: C: Style/Documentation: Missing top-level class documentation comment.
  class Application < Rails::Application
  ^^^^^

1 file inspected, 4 offenses detected, 3 offenses auto-correctable
```

## vscodeの設定＆起動
ここまでくれば、このvscodeがスクリプトをrubocopとして使うようにできれば完成です。

vscodeのruby拡張でformatterやlinterを設定できますが、通常のruby拡張 (`rebornix.ruby`) ではformatterのパスを指定することはできず^[linterは指定可能なのですが...]、本記事で用意した`rubocop`コマンドを使うことができません。
そこで`ruby-rubocop` (`misogi.ruby-rubocop`) という別の拡張を使うことで解決します。

上記拡張をインストールし、vscodeのsettings.jsonにて下記を設定します:
```json
"ruby.format": false,
"ruby.lint": {},
"[ruby]": {
  "editor.defaultFormatter": "misogi.ruby-rubocop"
},
"ruby.rubocop.executePath": "./backend/bin/",
```

やっていることは、通常のruby拡張によるformat/lintの無効化・formatterに使う拡張の指定・rubocopパスの指定です。

rubocopのパスは**実行ファイルのあるディレクトリ**を指定します。どうもこの拡張は `{executePathの値}rubocop`を実行するようで、rubocop自体のパスではなくディレクトリを指定し、末尾のスラッシュもつける必要があります。

これで独自に用意したrubocopコマンドにてformat/lintが実行されます^[linterは明示的に指定していませんがこれで動きます]。

:::details 記事初期公開時の内容（非推奨）

**以下の内容はアプローチが非常にハックなため推奨しません。上記rubocop拡張機能の利用を推奨します。**

---

しかしながら[rubocop-daemonのREADMEにもある](https://github.com/fohte/rubocop-daemon/tree/v0.3.2#use-with-vs-code)ように、vscodeは実行する`rubocop`のパスをカスタマイズすることはできません^[[元のissue](https://github.com/rubyide/vscode-ruby/issues/413)も[その次のissue](https://github.com/rubyide/vscode-ruby/issues/548)も長らく動いておらず、実装の気配はなさそうです。こ、コントリビュートチャンスか...？]。

そのため何かしらのハックをするわけですが、筆者が試したのは以下2点です。
どちらの場合でも、format on saveや通常のlintなどで高速なlint/formatが確認できるはずです。

#### 方法1 `backend/bin`をPATHに追加してvscodeを起動する
```shell:起動例
$ env PATH="$PWD/backend/bin:$PATH" code .
```

PATHの先頭にbackend/binを追加してvscodeを起動します。対象プロジェクト専用のvscodeをshellから起動する必要がありますが、PCのグローバル環境を汚染しません。

なおbundlerを経由せず`rubocop`を起動させるため、vscodeの設定で`"ruby.useBundler": false`としておく必要があります。docker-composeで開発してる環境なら大丈夫でしょう。

※例のスクリプトが`backend/bin/rubocop`にある前提

#### 方法2 スクリプトをPATHの通ったところにシンボリックリンクしておく
```shell:設定例
$ ln -s $PWD/backend/bin/rubocop /usr/local/bin
```
※作成先パスは環境による。適切に優先度の高いところへ

グローバルの`rubocop`を完全にこのスクリプトに置き換えます。vscodeの起動の都度PATHなどを気にする必要がなくなる反面、対象プロジェクト以外でrubocopが使えなくなります^[この点オリジナルのrubocop-daemon-wrapperはよく考えられていて、rubocop-daemonが無い場合は通常のrubocopとしても動作するようになっているようです]。

仕事PCで単独プロジェクトしか触らないとか、他のプロジェクトはbundler経由だから問題無いなど、特定条件下では有用だと思います。

:::


## まとめ
一部ハックな感じではありますが、一旦入れてしまえば大変高速なlintやformatがお楽しみいただけると思います。

format on saveジャンキーな方は試してみてはいかがでしょうか。
