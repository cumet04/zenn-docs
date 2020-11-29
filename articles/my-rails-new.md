---
title: "ぼくのかんがえたrails new"
emoji: "🔥"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [rails, 環境構築]
published: false
---

:::message
この記事は2019年12月15日にqiitaに投稿したものの移行記事となります。
元記事はこちら https://qiita.com/cumet04/items/f77459025c6c3008e31d
:::

ここ一年ほど、仕事で自分が新規プロダクトのrails newをすることが多く、そのたびに色々考えながら落ち着いてきた初期設定です。

範囲はrails newを実行してから実アプリケーションコードを書く直前までです。
※ベストプラクティスというよりは自分の好みの側面が強い備忘録的なものとなります。

なおリポジトリはこちら https://github.com/cumet04/my-rails-new

## ディレクトリを切る
`rails new`する前に、まずプロジェクトのディレクトリをざっくり切ります。

プロジェクトルートに以下のように切ります:

* backend
* frontend
* infra
* develop

Railsに限らずnodejs系などでもそうですが、近年の開発環境はいわゆるdotfilesが無数にあってわけがわからないため、トップレベルでディレクトリを分けます。

READMEなどを除いてできるだけプロジェクト直下にファイルを置かない想定です。

### backend
Railsプロジェクトのルートになるディレクトリです。この下で`rails new`を行います。
本記事の内容はこの節以外はほぼこのディレクトリ下の話です。

### frontend
nodejsなどのいわゆるfrontend系のコードを置きます。`package.json`がここにある、というようなイメージです。
Railsのコードにあまり深く関わってこないため、本記事内やサンプルリポジトリには登場しません。

### infra
サーバ構築用のansibleのコードやインフラ用のcloudformationのコードなどを置きます。
デプロイ関連のスクリプトも置いたりします。

### develop
開発環境で使うスクリプトやAPIモックなど、プロダクション環境での動作には関係ないものを置きます。
ちょい作業の便利スクリプトや種類の増えたdocker-compose.ymlなどです。
（docker-composeは1つしかなければプロジェクトルートにも置きますが）


## rails new
ディレクトリを切ったら`backend`下にて適当にrbenvやbundle initなどを行い`rails new`します。
ここではオプションを含めコマンドは以下になりました:

```
rails new . \
  --skip-action-mailbox \
  --skip-action-cable \
  --skip-sprockets \
  --skip-listen \
  --skip-javascript \
  --skip-turbolinks \
  --skip-webpack-install
```

オプションはアプリケーションの要件やRailsのバージョンによってかなり違うので、都度`rails new --help`とにらめっこして決めます。

js系はRailsには触らせない構成なので`javascript` `turbolinks` `webpack-install`あたりを落としておきます。
Rails5系以前だと`coffee`あたりも落とす必要があったと思います。

rails newができたらひとまず生成された`.git`の削除と`config/application.rb`のapplication名を修正し、そのまま`git add .`してcommitします。
あとから初期ファイルのコメント群などをガッツリ消すので、説明コメントなどを見たくなったときにgitの履歴から閲覧できるようにしておきます。

`.git`を削除するなら最初から`--skip-git`すればいいじゃないと思いますが、初期の`.gitignore`が欲しいので作ってから消しています。
慣れれば最初から`--skip-git`でよいと思います。

## 不要な初期コメント・ファイルを消す
各種ファイルをガッツリ掃除します。

### コメント系
`.gitignore`や`Gemfile`、`config/initializers/*`など説明用コメントがたくさんありますが、邪魔なので潔く消します。git履歴に残ってることですし。

initializersにはコメントのみのファイルもいくつかあるため、それらはファイルごと消します。
欲しくなったら追加しましょう。

### credentials.yml.enc / master.key
Rails5.2から追加されたcredentials系の管理機能ですが、個人的には環境変数で差し込む方法に対してメリットが見いだせないので使いません。

`credentials.yml.enc`をリポジトリから削除・master.keyをストレージとgitignoreから削除しておけばokです。

### Gemfile
コメントの他にいくつか使わないものを早めに掃除しておきます。

* byebug -> 自分は使わないのでgroupブロックごと削除（好みです）
* `group :test`ブロック -> この辺は少なくともRails下のrubyではやらないので消します
* tzinfo-data -> まぁwindows上では動かさないですね...

## environments設定
`config/environments/*`に置いているパラメータ系です。

デフォルトでは`environments/`下にある個別の`development.rb`や`production.rb`に必要な全パラメータが記述されていますが、
これに倣った場合、全環境に全く同じ記述がたくさんあったり環境ごとの差異がわかりにくかったりします。

そこで、production環境相当の設定を`config/application.rb`にすべて記述し、developmentなど他の環境についてはproductionとの差分のみ記述することとしました。

以下、rails new直後相当の設定を一部整理・移植したものです。

```ruby:config/application.rb(抜粋)
class Application < Rails::Application
  # Initialize configuration defaults for originally generated Rails version.
  config.load_defaults 6.0

  # rails environments configs
  config.cache_classes = true
  config.eager_load = true
  config.consider_all_requests_local = false
  config.action_controller.perform_caching = true

  config.public_file_server.enabled = false
  config.active_storage.service = :local
  config.cache_store = :null_store

  config.action_mailer.perform_caching = false

  config.log_level = :debug
  config.log_tags = [ :request_id ]
  config.logger = ActiveSupport::Logger.new(STDOUT)
  config.log_formatter = ::Logger::Formatter.new
  config.active_support.deprecation = :notify

  config.i18n.fallbacks = true
  config.active_record.dump_schema_after_migration = false

  # app configs
end
```

```ruby:config/environments/development.rb
Rails.application.configure do
  config.cache_classes = false
  config.eager_load = false
  config.action_controller.perform_caching = false
  config.cache_store = :null_store
  config.public_file_server.enabled = true

  config.consider_all_requests_local = true

  config.action_mailer.raise_delivery_errors = false
  config.action_mailer.perform_caching = false

  config.active_support.deprecation = :log

  config.active_record.migration_error = :page_load
  config.active_record.verbose_query_logs = true
  config.active_record.dump_schema_after_migration = true
end
```

```ruby:config/environments/production.rb
Rails.application.configure do
end
```

外部メールサーバやredisのセッション/キャッシュストアなどを使う場合はそれらのホスト名などが環境によって異なってきますが、それらは環境変数で定義して`application.rb`内で`ENV.fetch`などで読み込むようにしておくとスマートです。

以下、しれっとデフォルトから変更している部分です。

### cache_store / public_file_server.enabled
デフォルトではファイルの存在や環境変数でトグルするようになっていますが、運用上は環境によって設定が確定しているはずなので決め打ちにしておきます。

cacheについてはあとでredisなど導入する想定で一旦`:null_store`にしています。

### ログ出力
アプリケーションログについては環境によらず標準出力に出すようにします。

開発環境では`rails server`やdockerのため標準出力が良いですし、productionやstaging環境などにおいてもpumaと別個でログが出る必要がないのでひとまとめにしておきます。
サーバ上のログファイルの管理をlogrotateで一括でやりたいということもありますし、dockerで運用する場合でもstdout/stderrの二種類のみになっているほうが都合が良いです。


## その他ミドルウェアなど
要件によって必要・不要などありますが、ミドルウェア類とデバッグ系ツールを入れます。

### routes format
いきなりミドルウェアではないのですが、ルーティングの設定です。

Railsのルーティングではデフォルトで`format`が有効になっており、設定したURLの末尾に`.json`や`.xml`など拡張子的なものを追加するとそのフォーマットで元のパスにリクエストされたものと見做されます（controllerで`respond_to do |format|`するアレです）。

経験上これが必要になったことがなく、むしろ意図しないURLに意図しない処理が走ると問題なので、まるっと無効化します。
（同じデータに対しhtmlとjsonを返す要件はありますが、閲覧ページとAPIデータでは必要な情報粒度(URL)が違いますし、`/api/**`などプレフィックスして別のルーティングとして定義するのが自然かと思います）

```ruby
Rails.application.routes.draw do
  scope format: false do
    # For details on the DSL available within this file, see https://guides.rubyonrails.org/routing.html
    # このブロック内に通常のルーティングを記述する
  end
end
```

`Rails.application.config`や`Rails.application.routes.draw`の引数などで`format: false`を指定できればよいですが、残念ながらできないようなのでパス無指定のscopeでお茶を濁します。ネストが一段深くなってしまいますが、ルーティングなのでそこまで問題にはならないでしょう。


### デバッグ系
[better_errors](https://github.com/BetterErrors/better_errors)を入れたいので、Gemfileのdevelopment groupに

```
  gem "better_errors"
  gem "binding_of_caller"
```

を入れます。
また`config/environments/development.rb`に

```
BetterErrors::Middleware.allow_ip! "0.0.0.0/0"
```

を追加しておきます。これが無いとdocker環境などでbetter_errorsが表示されません。

また他にも好みで`pry-rails`を入れたりします。

### mysql
Railsプロジェクトだとだいたい何かしらのDBを使いますし、自分の場合はmysqlを使うことが多いです。
Gemfileにて`sqlite3`を削除、`mysql2`と（development groupに）`annotate`を入れます。

development環境でもdockerなりローカルマシンなりにmariadbを用意すればいいのでsqlite3は消します。
またannotateを入れるのであれば`rails generate annotate:install`しておきます。

`config/database.yml`は前述のenvironmentsの方針に則り以下のようになります:

```yaml:config/database.yml
default: &default
  adapter: mysql2
  encoding: utf8
  pool: <%= ENV.fetch("RAILS_MAX_THREADS") { 5 } %>
  timeout: 5000
  host: <%= ENV.fetch('RAILS_DB_HOST') %>
  port: <%= ENV.fetch('RAILS_DB_PORT', 3306) %>
  database: <%= ENV.fetch('RAILS_DB_DATABASE') %>
  username: <%= ENV.fetch('RAILS_DB_USERNAME') %>
  password: <%= ENV.fetch('RAILS_DB_PASSWORD') %>

development:
  <<: *default

production:
  <<: *default
```

スッキリです。実際にはconnection poolの数くらいは別個で指定します。

### redis session store
セッションをredisで持ちます。

Rails5系以前は[redis-rails](https://github.com/redis-store/redis-rails)を使っていましたが、Rails6以降はredis-actionpackをそのまま使えば良い^[https://github.com/redis-store/redis-rails/issues/95]ようです。

Gemfileに`redis-actionpack`を足し、`config/application.rb`にsession_storeの設定を入れます:

```ruby:config/application.rb
config.session_store(
  :redis_store,
  servers: {
    host: ENV.fetch("RAILS_REDIS_HOST"),
    port: ENV.fetch("RAILS_REDIS_PORT", 6379),
    namespace: "sessions",
  }, expire_in: 3.days, secure: true,
)
```

また開発環境はhttpsではないので忘れずに以下も入れておきます:

```ruby:config/environments/development.rb
config.session_options[:secure] = false
```


## まとめ
rubyを用意して`rails new`するだけかと思いきや、アプリケーションコードを書くまでに考えるべき共通事項は案外多いです。

これは自分のよくある環境での一つの解でしかなく、開発体制やアプリケーションの規模、全体アーキテクチャによってもかなり変わってくると思いますが、考え方などなにか参考になればと思います。
