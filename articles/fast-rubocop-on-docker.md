---
title: "Ruby on Docker環境で高速にrubocopする"
emoji: "📚"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [ruby, docker, rubocop, vscode, rails]
published: false
---

数年前にgo/gofmtに触れて以降、CodeFormat on Saveされないとソワソワする体質になってしまい、仕事のRails開発においても`"ruby.format": "rubocop"`してFormat on Saveしています。  
しかしながらrubocopは起動が遅く、Ctrl+SしてからFormat & Saveされるまでに1~2秒かかってしまい大変ストレスフル...

そこでrubocop実行を高速に、またDocker環境で満足に動くように試みました。

## TL;DR
既存プロジェクトのdocker-composeに[rubocop-daemon](https://github.com/fohte/rubocop-daemon)を追加し、そこにローカルからコマンドを送信してrubocopとして動かせる環境を作った。

rubocop-daemon本体のforkおよび機能追加、composeの設定、環境特化のwrapperスクリプト（`rubocop`として動くもの）を作り、vscodeからformatterとして実行できる環境を記した。

成果物と試行錯誤ログはこちら
https://github.com/cumet04/sbox_rubocop-daemon-on-docker
https://zenn.dev/cumet04/scraps/fae984bf1de5e5

なお手っ取り早く導入だけしたい方は上記リポジトリより`README.md`, `docker-compose.yml`, `backend/bin/rubocop`だけ読めばokです。

:::message
以降、記載するコードは抜粋のみのため、必要に応じて上記リポジトリを参照してください。
:::

## rubocop-daemon
https://github.com/fohte/rubocop-daemon

rubocopをrequireしたdaemonを起動しておき、実際のCLIはdaemonへのコマンド送信と結果受信のみ行う（処理はdaemonが実行）というツールです。都度の実行時に起動オーバーヘッドが発生せず早い、という仕組みです。

これや！求めていたのはこれや！こいつをdocker-composeで動かせばええんや！
...と思ったのですが、実装的にdocker環境で動かす想定はなさそうで、一工夫いりそうです。

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

この環境に、ひとまずrubocop-daemonを追加します。

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
ただしこれでは`docker-compose exec`と`bundle exec rubocop-daemon`それぞれの起動オーバーヘッドが発生し、下手すると普通にrubocopを動かすより遅くなってしまいます。

ここはやはり[より速く](https://github.com/fohte/rubocop-daemon#more-speed)、rubocop-daemonのリポジトリにある`rubocop-daemon-wrapper`をローカル実行できるようにしたいところです。

:::message
ここまでは動作確認のみのため`rubocop_daemon`コンテナにローカルのソースコードをマウントしていませんが、もしこのまま利用するのであればvolumesに追加しておく必要があります。
:::

## wrapperを読み解く
そのためにはwrapperが何をしているのか確認します。
[記事投稿時点での該当コード](https://github.com/fohte/rubocop-daemon/blob/v0.3.2/bin/rubocop-daemon-wrapper)を見ながらざっくり動作を追っていきます。

#### 5-14行目
`rubocop-daemon`コマンドを実行し、失敗であれば通常のrubocopを実行して終了しています。

rubocop-daemonをオプション無し実行すると何もせず正常終了するので、これは要するに「rubocop-daemonが使えなければ通常のrubocopにfallback」なのだと思われます^[ちょっとコード読みと解釈に自信が無いのですが...これrubocopコマンドに上書きする想定のスクリプトなので多分あってるはず。]。

#### 16-42行目
あとで使う`nc`コマンドのオプションをOS/ディストリによって分岐しています。
ざっくり、オプション無しもしくは`-N`付きの2パターンあるようです。

#### 44-56行目
プロジェクトルートのディレクトリ名を取得しています。
rubocop-daemonはdaemonのステータスを格納するディレクトリにこの名前を使うため、これを特定しないことには目的のステータスのパスがわからないためです。

#### 58-66行目
daemonの各種ステータスのファイル名を取得しています。
ここを見ると「ステータスのファイルは`$HOME/.cache/rubocop-daemon/{project-dir-name}/`以下にある」ということがわかります。

#### 68-88行目
コマンド実行の排他制御を行っています。
[issue](https://github.com/fohte/rubocop-daemon/issues/12)によると、複数並列実行した際に終了コードをstatusファイルからうまく取れない問題への対処のようです。

#### 90-97行目
標準入力のデータを受け取る場合（`-s` `--stdin`オプションが指定されている場合）に標準入力のデータを取り出しています。


## daemonをcomposeで動かす

### outbound

## wrapperスクリプトを書く

## vscodeの設定＆起動

## まとめ
