---
title: "Dockerビルドを分離してデプロイを高速化した話"
emoji: "🐥"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [docker, frontend]
published: false
---

:::message

この記事は『[LITALICO Engineers Advent Calendar 2020](https://qiita.com/advent-calendar/2020/litalico)』7日目の記事です。
:::

10月から新しいプロジェクトにジョインしたのですが、そのデプロイがなかなかに遅く、リリースならともかくステージング環境などへのデプロイでもジョブ開始後に飲み物を飲みに行ったりトイレに行ったりと少々時間を潰すような状況でした。

チームの中で自分が比較的インフラやDockerビルドなどに詳しいということ、また幸い今のチームには一週間のうち一日を事業KPIなどに紐付かない業務改善・負債返済に当てるToDoDay/HackDayと呼ばれる取り組みがあるため、この時間を使って問題の解決を試みました。

# TL;DR
Railsセットアップ・webpackフロントエンドビルド・アセットのS3アップロードが単独のDockerfileで全部実行されていたところからフロントエンドを分離し、バックエンドのみの変更に対するデプロイではフロントエンドビルドが実行されないようにした。

条件付きとはいえデプロイ時間の8割近くを占めていた処理がスキップされるようになり、開発体験の向上に寄与した。

# もともとどうなっていたか
まず、改善前時点での対象アプリケーションの構成やデプロイフローをざっと確認します。

:::message
記事中で示すDockerfileやソースコードなどは説明のため（特に環境変数などが）省略・簡略化されています。これらは実際の環境で動いてるままではなく、処理の概要を掴むためのものとなります。
:::

## アプリケーションとデプロイの構成
Railsバックエンド+Reactフロントエンドで、ほぼAPI+ブラウザ側アプリケーションの構成^[ページごとにフロントエンドのエントリポイントが分離していることや、サーバ側でjsonをrenderしている部分があるなど、API+SPAとは言えない構成ですが本記事では関係ないため割愛します]です。
フロントエンドはRailsとは分離したwebpackプロジェクトになっていますが、古いページに一部Railsのアセット管理に乗ったjs/cssが存在しています。

RailsアプリケーションがDockerコンテナでAmazon ECS上で動作しており、js/cssなどアセット類（webpackビルド青果物 + Railsアセットビルド成果物）はS3にアップロードされCloudfront経由でwebアクセスされます。

まとめると、デプロイで実施されるべきことは
1. Railsコンテナのイメージビルド（bundle + ソースコード配置）
2. アセットビルド (webpack + Rails assets)
3. アセットのS3へのアップロード
4. RailsコンテナイメージのECRへのプッシュ & ECS上のコンテナ入れ替え

となっています。

## もともとのデプロイ処理
前述の実施されるべきことのうち、1,2,3が単独のDockerビルドフローで実施されていました。

概略を伝えるため、簡略化した疑似Dockerfileを示します:
```dockerfile:baseイメージ
FROM ruby
RUN apt-get install -y nodejs some-other-packages ...
RUN npm install -g yarn

COPY Gemfile Gemfile.lock
RUN bundle install
COPY . /app
```

```dockerfile:デプロイ用イメージ
FROM base

RUN yarn && yarn run build \
  && bundle exec rails assets:precompile \
  && bundle exec rails assets:sync \
  && find /app/public/packs -type f ! -name "manifest.json" -exec rm {} \;
```
※baseイメージはローカル環境でも使われる汎用イメージ、デプロイ用はデプロイ時にビルドされプロダクション環境で実際に動くもの
※`rails assets:sync`は[アセット類をS3にアップロードするgem](https://github.com/AssetSync/asset_sync)のタスク

デプロイ時にはbaseのビルド -> デプロイ用のビルドと直列に実行されますが、base最後にあるソースコードの追加のあとにデプロイ用でのフロントエンドやその他の処理が実行される構造となっています。
そのため、フロントエンドに何の変更も無い場合であっても`yarn`や`yarn run build`などが毎回実行されてしまいます。

またwebpackでのビルド時に[ManifestPlugin](https://github.com/shellscape/webpack-manifest-plugin)を使って`manifest.json`を生成しており、そのファイルはRailsから参照できる必要があるため、アップロード済ファイルの削除時にそれだけを残すようにしています。

## じゃあどうするか
フロントエンドビルドがバックエンドのソースに依存しないように分離する方針を採ります。
`assets:sync`を実行する際にその実行コンテキストに`yarn run build`と`assets:precompile`の成果物がありさえすればよいため、ビルド自体は別々に実行できるはずです。

またフロントエンドビルドはソースに変更があった場合のみ実行するようにします。

# 実際に改善する
この方針に従い、全体フローや各ビルド要素の処理を整理していきました。

## フロントエンドビルド
まずは分離したフロントエンドビルド用Dockerfileです。

```dockerfile
FROM node:12.18.4

RUN mkdir -p /app/frontend /app/public
WORKDIR /app/frontend

COPY package.json yarn.lock ./
RUN yarn

COPY . .
RUN yarn build
```

基本的にいわゆる普通のフロントエンドビルドのDockerfileな感じになっています。
※ディレクトリの切り方が少し変わっているのはリポジトリ上のディレクトリ構成の都合であり、特に改善に関するものではありません。

本記事における改善でのポイントとしては、一般的にはDockerイメージには実行環境だけを用意してビルドやジョブ実行などは`docker run`するところを敢えてdocker buildの中で`yarn run build`している点です。

このプロジェクトではビルド・デプロイがJenkinsサーバ上で実行されており、Dockerイメージ・レイヤキャッシュに低コストでアクセスできるという背景があり、「ソースに変更が無い場合にビルドしない」を実現する手段としてDockerレイヤキャッシュを活用するのが手っ取り早いという判断です。
こうすることで、ビルド実行フローではソースの変更有無を気にせず`docker build`するだけでいい感じにビルド処理が実行されたりスキップされたりを実現できました。

:::message
都度Dockerイメージをpushする必要があったりレイヤキャッシュが刹那的なCI環境 (Github Actions, CircleCI, CodeBuildなど) では、イメージ/キャッシュのpush/pullのオーバーヘッドが無視できない可能性があり別のアプローチが必要になるかもしれません
:::

## バックエンドコンテナ
続いてバックエンドコンテナです。baseイメージは変わっていませんが再掲しています。

```dockerfile:baseイメージ
FROM ruby
RUN apt-get install -y nodejs some-other-packages ...
RUN npm install -g yarn

COPY Gemfile Gemfile.lock
RUN bundle install
COPY . /app
```

```dockerfile:デプロイ用イメージ
FROM c-navi_base:latest

RUN bundle exec rails assets:precompile

RUN mkdir -p /app/public/packs
COPY ./public/packs/manifest.json /app/public/packs/
```

改善後のデプロイ用イメージではyarnでのフロントエンド系の処理は何もせず、Railsの`assets:precompile`の実行およびフロントエンドビルド生成物の`manifest.json`の取り込みを行っています。

これでは全ビルド毎に`assets:precompile`は実行されてしまうのですが、現行プロジェクトではRailsのassetsを使っている部分は非常に少なく時間がかからないこと・こちらの`manifest.json`も別途取り込む必要があることから、Dockerビルド内部で実行するのが楽と判断しました。

「フロントエンドビルド生成物の`manifest.json`」はどこにあるのかですが、これについては後述のビルドスクリプトにて説明します。

## アセットのビルド＆アップロード
最後に前述の二種類のDockerビルドを含めたビルド全体のスクリプトです。
dockerコマンドをゴチャゴチャと取り回しているため、ブロックごとにコメントを入れています。

```bash:deploy.sh
ECR_REPO=xxxxxxxxxxxx.dkr.ecr.ap-northeast-1.amazonaws.com
APP_IMAGE=project/app:$COMMIT_HASH

# frontend build & assets取り出し
docker build -t app_frontend frontend
FE_CONTAINER=$(docker create app_frontend)
docker cp $FE_CONTAINER:/app/public/packs ./public/
docker rm $FE_CONTAINER

# app build
docker build -t base .  # baseイメージのビルド
docker build -t $APP_IMAGE -f containers/with_asset/Dockerfile .  # デプロイ用イメージのビルド
docker tag $APP_IMAGE $ECR_REPO/$APP_IMAGE

# assets sync & clean
docker run --rm -i -v "$PWD/public/packs:/app/public/packs" $APP_IMAGE \
  env RAILS_MASTER_KEY=$RAILS_MASTER_KEY bundle exec rails assets:sync RAILS_ENV=$RAILS_ENV AWS_ENV=$AWS_ENV
rm -r ./public/packs
```

#### frontend build & assets取り出し
「フロントエンドのDocker buildを実行し、そのイメージから成果物をローカルに取り出す」という処理をしています。
`docker create`により内部のプロセスを開始せずにコンテナが生成され、そのコンテナから`docker cp`でファイルをローカル（ビルドマシンのストレージ）に取り出し、`docker rm`で用が済んだコンテナを片付けています。

ビルドコンテキストを`frontend`ディレクトリに指定しているため、ここに無関係なファイルが変更されたデプロイの場合はDockerレイヤキャッシュが効いて重いビルド処理がスキップされます。

#### app build
これは単純にbaseイメージとデプロイ用イメージをそれぞれ`docker build`しています。
直前のフロントエンドビルドにてローカルの`./public/packs`に成果物を展開していることで、デプロイ用イメージの`COPY ./public/packs/manifest.json /app/public/packs/`にて正しく最新の`manifest.json`を取り込めます。

#### assets sync & clean
最後にビルドされたアセットファイル一式を`assets:sync`でS3にアップロードしています。
`-v`オプションでローカルにあるフロントエンド成果物をコンテナ内にマウントしており、また`assets:precompile`はイメージ内にあるため、この`assets:sync`の実行によってこれらがまとめてS3にアップロードされます。

この流れにより、アプリケーションのDockerイメージがビルドされ、フロントエンドビルドは必要に応じてスキップされつつ必要なファイルをS3にアップロードするという流れが実現されます。

# 結果
以前は変更の種類に関わらずデプロイ全体で16~18分ほど要していたものが、バックエンドのみの変更であれば5分程度で完了するようになりました。
フロントエンド変更がある場合は14~15分程度となっています^[なおどの種類のデプロイであっても時間全体のうち3分~3分半ほどはECSのBlueGreenデプロイの完了待ちが占めています]。

フロントエンドについても、`yarn`が毎回実行されなくなったことやその他ビルドフローの整備により従来あった無駄な処理が減ったことにより、デプロイ全体で1~2分の短縮になりました。

# まとめ
バックエンドのみの変更という条件下ではありますが、ビルドフローの整備によりデプロイの所要時間が大きく改善できました。

これにより、ちょっとした動作修正などをステージング環境で確認する際などに非常にカジュアルにデプロイすることができるようになり、開発体験だけでなく検証頻度が上がることによるリリース品質の向上も見込まれます。

フロントエンドビルドの改善は別途課題となっています^[こちらは本件より後日に別途実施しましたが、その紹介はまた機会があれば]が、今後も様々な面で改善を続けていきたいと思います。
