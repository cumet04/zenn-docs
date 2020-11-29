---
title: "RailsのViewを（ほぼ）全部Vue.jsで書く仕組みを試みてみた"
emoji: "📝"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [rails, vue]
published: false
---

:::message
この記事は2020年5月6日にqiitaに投稿したものの移行記事となります。
元記事はこちら https://qiita.com/cumet04/items/52cc84949a7ce9351317
:::

最近のRailsのViewはどんな感じに書くのだろうと調べてみると、どうもwebpackをrails wayにラップするwebpackerというのがあるらしい。

あのいろんな役割関係や依存が複雑に絡み合うフロントエンド界隈に更にRailsの依存を入れるのは嫌だなぁと思い、せっかくなので逆にがっつり分離させる仕組みを考えて試してみました。

# やりたいこと
従来式のRailsアプリケーションにてView (html rendering) 層を可能な限りjsプロジェクト側で書ける仕組みを作り、Rails動作環境とjsビルド環境の完全分離を目指します。
js側には最近趣味で触っているVue.jsを使い、ファイル構造などはNuxt.jsを少し意識したものとします。

※なお本記事の内容は思いつきの実験の側面が強く、本格的な実用性は深く考慮はしていません。
一般的にはRailsのAPIサーバとフロントエンドのSPAの構成にするのが堅実だと思います。

# アイデア
RailsのHTTPレスポンスには表示データ（のJSON文字列）・Vueのマウントポイント・表示すべきViewの識別子を含んでおき、ブラウザ側でページ用Vueコンポーネントをマウントする、というのがベースアイデアです。

表示すべきViewの識別子があればマウントするコンポーネントを特定できるし、表示データをコンポーネントにpropsとして渡してマウントすればそこから先は全てVueの流儀で書けるはず、という想定です。

またRailsとVue間の情報の受け渡しは単純なhtmlデータとして行うため、実行環境やビルドまわりの相互依存は発生しません。^[あくまでパッケージやミドルウェア的な依存が発生しないだけで、情報の形式や処理手順などの依存は発生します。]

# 成果物
この試みベースのサンプル成果物はこちらです: https://github.com/cumet04/rails_vue_app/tree/qiita_20200506
記事中に必要なコードは提示していますが、こちらで全体像を見ながらでないと分かりづらいかもしれません。

なおこのリポジトリは筆者のコードスニペット集を目的とした作り込みがあり、本記事の試みとは全く関係のない部分が（主にバックエンドに）多くなっています。

# 動作とコード

## Rails側
Railsが返すhtml部分のテンプレート (layout) は以下のようになっています:

```html:backend/app/views/layouts/application.html.erb
<!DOCTYPE html>
<html>
  <head>
    <title>RailsVue</title>
    <%= csrf_meta_tags %>
    <%= csp_meta_tag %>
    <script id="page_prop_data" type="text/plain">
      <%= prop_data_json %>
    </script>
    <script type="text/javascript">
      window._application = {
        path: "<%= view_uri %>",
        props: JSON.parse(document.head.children["page_prop_data"].innerText)
      }
    </script>
  </head>
  <body>
    <div id="app"></div>
    <script src="<%= assets_url("bundle.js") %>"></script>
  </body>
</html>
```

Rails特有の`csrf_meta_tags`なども入っていますが、ここでのポイントは

* 表示データ用scriptタグ (`id="page_prop_data"`)
* データ保持用scriptタグ (`type="text/javascript"`)
* Vueマウント用DOM (`id="app"`)
* フロントエンドのエントリポイントjs (srcが指定されたscriptタグ)

以下詳細です。（マウント用DOM除く）

### 表示データ用scriptタグ
ページに表示するデータをcontrollerで生成し、JSON文字列として単独のscriptタグの中に入れます。

このアプリケーションでは、controllerの全アクション共通で`@_view_props`という変数にハッシュでデータを入れておき、layoutをrenderする際に`prop_data_json`ヘルパーでJSON文字列化しています。

```ruby:backend/app/helpers/application_helper.rb
...
  def prop_data_json
    raw((@_view_props || {}).to_json)
  end
...
```

なおこのデータはブラウザ側で`JSON.parse`されるだけですが、データ保持用scriptタグの中に直接展開する（`props: JSON.parse('<%= prop_data_json %>')`のようにする）とjavascriptの文字列リテラルのエスケープの都合で一部記号の扱いが大変面倒になります。
そこで、JSON文字列のみを生文字列として格納するscriptタグを用意しています。

### データ保持用scriptタグ
表示すべきViewの識別子と前述のJSONデータをjsの変数グローバル空間に展開します。

JSONデータは前述のデータ用scriptタグの中身を`JSON.parse`するだけです。

「表示すべきViewの識別子」ですが、これは表示するURLのパス部とほぼ同一です。
実際のURLのパス部とは、URLにquery-paramが入った場合にそれをパラメータ名に戻したものを返す点が違います。

```ruby:backend/config/routes.rb
...
Rails.application.config._routing_map =
  Rails.application.routes.routes
    .map { |r|
    ActionDispatch::Routing::RouteWrapper.new(r)
  }
    .reject(&:internal?)
    .to_h { |r|
    [
      r.endpoint,
      r.path.tr(":", "_"), # for path param
    # when using 'format: true' in routes, add 'remove("(.:format)")'
    ]
  }
```

```ruby:backend/app/helpers/application_helper.rb
...
  def view_uri
    key = "#{params[:controller]}##{params[:action]}"
    Rails.application.config._routing_map[key]
  end
...
```

URLから直接query-param実体をパラメータ名に戻すことはできないため、ルーティング定義直後にあらかじめ`controlle#action => view_url`のマッピングを生成しておき、render時に`view_uri`ヘルパーで解決しています。

なおマッピング生成のコードは`rails routes`タスクのコードを参考にしており、生成されるマップのデータもroutesタスクの一部を切り出したようなものになります。

```ruby:Rails.application.config._routing_map(例)
{"home#index"=>"/",
 "users#index"=>"/users",
 "users#create"=>"/users",
 "users#new"=>"/users/new",
 "users#show"=>"/users/_id"}
```

これにより、リクエストしたURL（厳密には処理したcontroller action）と対応する識別子が取り出せます。

### フロントエンドのエントリポイントjs
Vue.jsやフロントエンド側コードを含む、bundleされたjsを読み込みます。

このファイルは開発環境ではwebpack-dev-serverから、デプロイされた環境では静的ファイルとして読まれることになり、読み込み元オリジンが環境によって違います。
そこで`assets_url`ヘルパーを用意し、オリジン部分をアプリケーションのパラメータとして指定できるようにしています。

```ruby:backend/app/helpers/application_helper.rb
module ApplicationHelper
  def assets_url(path)
    "#{Rails.application.config.assets_path}/#{path}"
  end
...
```

### その他ヘルパー
その他、仕組上あるとうれしいヘルパー系です。

```ruby:backend/app/controllers/application_controller.rb
...
  def view_props
    @_view_props ||= {}
  end
...
```

controllerで表示データをセットする際に`@_view_props`にアクセスするヘルパーです。
初期化など気にせずに`view_props[:user] = foo`などできるように入れています。

```ruby:backend/app/controllers/application_controller.rb
...
  # override ActionController::ImplicitRender for omitting view file per action
  def default_render
    render(html: "", layout: true)
  end
...
```

通常のRailsアプリケーションではcontroller#actionに対応するviewファイルが存在しますが、この仕組みではデフォルトレイアウトしかrenderしません。
そこで、actionごとのviewファイルがデフォルトで不要となるようにするメソッドoverrideを入れています。
（これをやらない場合、`app/views/users/index.html.erb`などの空ファイルを用意しないとエラーになる）

## Vue側
フロントエンドは、scriptタグから読み込まれるエントリポイントjs (index.js) があり、webpackにてここを起点にbundleするかたちです。

```javascript:frontend/src/index.js
import Vue from "vue";
import Layout from "~/layouts/default";

import RailsForm from "~/components/RailsForm";
Vue.component("rails-form", RailsForm);

Vue.mixin({
  methods: {
    imageUrl(path) {
      const file = require(`~/assets/images/${path}`);
      return `${ASSETS_PATH}/${file}`;
    },
  },
});

new Vue({
  el: "#app",
  components: { Layout },
  template: `<Layout></Layout>`,
});
```

ここでは一部ヘルパーを定義したのち、ページレイアウト用Vueコンポーネントをマウントしています。
（`RailsForm`, `imageUrl`は後述）

### レイアウト用コンポーネント
フロントエンド側でまずrenderされる全体コンポーネントです。

```vue:frontend/src/layouts/default.vue
<template>
  <div class="layout_root">
    <the-header :user="ViewProps.currentUser"></the-header>
    <div class="spacer"></div>
    <div class="page_wrapper">
      <Page :props="ViewProps"></Page>
    </div>
  </div>
</template>

<script>
import { Page, ViewProps } from "./vars";
import TheHeader from "~/components/TheHeader";

export default {
  components: {
    Page,
    "the-header": TheHeader,
  },
  data: () => ({
    ViewProps,
  }),
};
</script>
```

（`.spacer`や`the-header`コンポーネントは記事の本題に直接関係はありません）

ファイル配置も役割も、Nuxt.jsにおけるlayoutと同一です。違う点は、ページコンポーネント（`<Page>`, Nuxtでは`<nuxt>`）を明示的に指定していること、初期データ (`ViewProps`) を与えている点です。
両者ともに`vars.js`で解決しています。

```javascript:frontend/src/layouts/vars.js
import { Pages } from "~/pages";

const name = window._application.path
  .replace(/^\//, "") // trim initial slash
  .replace(/\/$/, "") // trim trailing slash
  .replace(/^$/, "index"); // "index" for "/"

const ViewProps = window._application.props;
const Page = Pages[name];

export { Page, ViewProps };
```

ここではRails側から渡されたパラメータを読み取っています。`ViewProps`は`JSON.parse`されたデータをそのまま代入しexportします。

`Page`はページ識別子を正規化したものを使って対象のページコンポーネントを解決しています。（`Pages`の中身については後述）

なお`layouts`ディレクトリに配置していますが、いまのところ複数レイアウトを切り替える仕組みは考えられていません...

### ページコンポーネントのマッピング
ページ識別子と実際のページコンポーネントのマッピングも事前に作成しておく必要があります。

ページコンポーネント群はNuxt.jsと同じように`pages`ディレクトリ配下にURLと対応した構造で.vueファイルを配置します。
そのファイル構造から、（webpackのビルドより）事前にコンポーネントをimportしたリスト用jsファイルを生成しておきます。

生成コードは[割と泥臭いのでリンクする](https://github.com/cumet04/rails_vue_app/blob/qiita_20200506/frontend/lib/gen-imports.js)に留めますが、以下のようなファイルツリーから`pages.js`（前述のvars.jsでimportされている）が生成されます:

```:ファイルツリー
src/
  index.js
  pages.js
  pages/
    index.vue
    nested/
      index.vue
      some.vue
      _id.vue
  ...
```

```javascript:frontend/src/pages.js
export let Pages = {
  "index": require("./pages/index").default,
  "nested": require("./pages/nested/index").default,
  "nested/some": require("./pages/nested/some").default,
  "nested/_id": require("./pages/nested/_id").default,
};
```

ページ表示時にこのマッピングから実際にマウントするページコンポーネントを選び、マウントすることになります。

ここまでで

1. サーバにリクエストされたURLに対応するRailsのcontroller actionが発火
2. controller actionに対応する表示ページ識別子がhtmlに渡される
3. 識別子より上記マッピングを使ってページコンポーネントを特定する

という流れにより、リクエストに対して適切なViewの選択・表示が実現されます。

### その他ヘルパー
その他フロントエンド側のコンポーネント・ヘルパーです。

```vue:frontend/src/components/RailsForm.vue
<template>
  <form :action="action" :method="formMethod">
    <input
      v-if="hiddenMethod"
      type="hidden"
      name="_method"
      :value="hiddenMethod"
    />
    <input type="hidden" :name="param" :value="token" />
    <slot></slot>
  </form>
</template>

<script>
export default {
  props: ["action", "method"],
  data: () => ({
    param: document.head.children["csrf-param"].content,
    token: document.head.children["csrf-token"].content,
  }),
  computed: {
    formMethod() {
      const m = this.method.toUpperCase();
      return m == "GET" || m == "POST" ? m : "POST";
    },
    hiddenMethod() {
      const m = this.method.toUpperCase();
      return m == "GET" || m == "POST" ? null : m;
    },
  },
};
</script>
```

Railsの`form_tag`相当のコンポーネントです。
POST系操作はRails-wayに準じるため、これにてformタグによるPUTやDELETEメソッドの扱い・csrf-tokenの処理を再現しています。

なおcsrf-tokenはRailsのレイアウトにて共通指定のものを使うため、フォームごとに異なるcsrf-tokenを使う（下記記事参照）ことはできず、セキュリティ的に少し弱くなっています。
https://techracho.bpsinc.jp/hachi8833/2017_04_19/38922

```javascript:frontend/src/index.js
...
Vue.mixin({
  methods: {
    imageUrl(path) {
      const file = require(`~/assets/images/${path}`);
      return `${ASSETS_PATH}/${file}`;
    },
  },
});
...
```

imgタグのsrcなどで画像を表示するためのパスヘルパーです。`<img :src="imageUrl('ico-account.svg')" />`などのように使います。ファイル実体のbundleなどは`file-loader`などに任せています。

開発環境ではブラウザで表示しているページのオリジンとwebpack-dev-serverのオリジンが違うため、画像をブラウザから読み込む際は明示的にオリジンを指定しないとRails側のサーバにリクエストしてしまいます。

なお`ASSETS_PATH`の定義は以下のように開発環境とそれ以外で分岐しています。

```javascript:frontend/webpack.config.js
...
const port = process.env.PORT || 8080;
const assets_path = "/assets";
...
  plugins: [
    new VueLoaderPlugin(),
    new webpack.DefinePlugin({
      ASSETS_PATH:
        process.env.NODE_ENV == "development"
          ? JSON.stringify(`http://localhost:${port}`)
          : JSON.stringify(assets_path),
    }),
  ],
...
```

# まとめ
ベースアイデアは割と単純なのでちょっとフローを整えればすぐできると思っていたのですが、案外補助コードが色々必要になりました。

また、こういうアプリケーションコードより少し低いレイヤに手を入れてみると、普段利用しているフレームワークやライブラリが何をしてくれているのか・どういう仕組みで動いているのかの理解が深まってとてもよいですね。

なお現時点ではエラー系の処理・表示が全くできておらず、考慮の必要があります。
ざっと考えられるものでもサーバサイド例外時の表示・JSONパース失敗・Vueのロジックエラーそれぞれ対応が必要になるかと思います。
※VueのエラーはVue.jsの仕組みで完結しそうですが

こんなネタもある、とちょっとしたコンテンツになればうれしいです。
