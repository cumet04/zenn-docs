---
title: "pullreq毎にprivateなstorybook(や静的webサイト)プレビューを作る"
emoji: "😺"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [storybook, s3, githubactions]
published: true
---

お、pullreqきてる。コンポーネント生やしたのかなるほど。storybookにも追加されてるな。

**...ちらっとでいいからstorybookの画面でも触りたいなぁ。**

## TL;DR
webアクセスをIP制限したS3バケットを用意し、pullreqごとにgithub actionsでstorybookをビルド・S3にアップ・pullreqにURLをコメント、という仕組みを作った

:::message
以降、フロントエンドの簡単な環境構築・AWSのリソース作成・github actionsの設定を行いますが、これら自体の詳細な説明はしません。それぞれ多少触ったことがある程度を想定しています。
:::

# やりたいこと
- pullreqごとにstorybookの画面を見たい
- テスト環境にアップしてもらったり、checkoutしてビルドして、とかは面倒
- プレビューはインターネットに公開したくない（アクセス制限したい）

ちらっと見れればよいのです。pullreqにスッと置かれたリンクをおもむろに押して、軽く触ってみて、うんうん、と頷くくらいがよいのです。

![pullreq comment](https://storage.googleapis.com/zenn-user-upload/zrzsiil7xsdsd7d8frv0zchctji2)

:::message
本記事ではstorybookを対象としていますが、webホスティングを要するものなら何でもできます。OpenAPIのドキュメントページでも静的webサイトの成果物でもOK。
:::

なお成果物のリポジトリはこちら: https://github.com/cumet04/sbox_storybook-on-pullreq/tree/20201208_zenn

# 事前準備: storybook環境をつくる
というわけで、本記事ではそんな仕組みを作っていきます。
見れるようにする対象はstorybookなので、何はともあれstorybookが動くサンプル環境を用意します。ここは特に工夫は無いので、最小手数でいきます。

まずはサンプルとして適当なReactの環境を用意します^[ReactでもVueでも何でも問題ありません。storybookが動けばok]。`npx create-react-app`でもいいのですが、今回は自分で[サクッと用意](https://github.com/cumet04/sbox_storybook-on-pullreq/commit/adf0b3e2c9a154819b7b775333fcdb4838e853fc)しました。ひとまず、`package.json`に`react`があれば大丈夫だと思います^[`npx sb init`コマンドが既存環境の判定をするのですが、それに引っかかればok]。

次にstorybookを導入します。[公式のガイド](https://storybook.js.org/docs/react/get-started/install)に従い`npx sb init`すると何やらサンプル環境一式が展開されます。
ここまででは`npm run build-storybook`でstorybookの静的ファイル群がビルドされれば良いです。

# プライベートなS3のwebアクセス環境を作る
次に、ビルドされたstorybookを見る環境を用意します。静的webホスティングが簡単にでき、かつ**お手軽にアクセス制限を実施できる**もの、ということでS3をチョイスしました。

:::message
簡単にwebホスティングができるものとしてはnetlifyやfirebaseがありますが、アクセス制限をするには有料プランが必要 (netlifyのPROプラン)だったり関数で頑張る (firebase functions) 必要がありお手軽ではありませんでした。
:::

S3のオブジェクトにはオブジェクトURLという読み取り用URLがあり、権限があればブラウザでアクセスすることができます。
通常はAWSコンソールにログインするなどしないと閲覧できないのですが、ここに「IPさえ合っていればユーザやサービスの条件を問わずにアクセス可能」という権限設定をすることで、事実上のIP制限付きwebホスティング環境とすることができます。

## S3バケットを作る
ということでS3バケットを作ります。AWSコンソールから作成していきますが、バケット名以外はデフォルトで問題ありません。「パブリックアクセスをすべてブロック」にチェックが入っていると思いますが、**そのままで良い**です。

次にアクセス制限の設定を付与します。作成したバケット名をクリックし、詳細画面で「アクセス許可」のタブを選択し、バケットポリシーを編集します。

![AWSコンソールのバケットポリシーの設定画面](https://storage.googleapis.com/zenn-user-upload/89iiomwql09w00g3jq4htqovmkal)
※実際にはタブの下に「ブロックパブリックアクセス (バケット設定)」がありますが、スクショの都合で邪魔だったため少しどいていただきました。
※スクショにある名前のバケットは記事公開時には消している予定です。

なお設定するバケットポリシーの内容は以下です:
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": "*",
            "Action": "s3:GetObject",
            "Resource": "arn:aws:s3:::your-s3-bucket-name/*",
            "Condition": {
                "IpAddress": {
                    "aws:SourceIp": "xxx.xxx.xxx.xxx/32"
                }
            }
        }
    ]
}
```

`Resource`のバケット名の部分と`aws:SourceIp`のIPの部分をいい感じに設定しましょう。IPを複数設定したい場合は`"aws:SourceIp": ["xxx.xxx.xxx.xxx/aa", "yyy.yyy.yyy.yyy/bb"]`のように配列で指定できます。

ここまでできたら適当なファイルをバケットにアップロードし、オブジェクト詳細画面にあるオブジェクトURLに所定のIPからアクセスできることを確認しておきましょう。

:::message
S3にはwebホスティング機能が別途存在しますが、そちらを使っても上記設定でアクセス制限ができます。今回は利用していませんが、そちらを使うとwebホスティング的に小回りが効きます。
:::

## アップロード用のIAMユーザを作る
このバケットにgithub actionsからファイルを読み書きするIAMユーザを作成します。

まずはユーザにアタッチするポリシーを作成します。内容は
- S3サービスへの`ListBucket`, `GetObject`, `DeleteObject`アクションの許可
- 対象リソースは`arn:aws:s3:::your-s3-bucket-name`, `arn:aws:s3:::your-s3-bucket-name/*`

です。JSONにすると
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Action": [
                "s3:PutObject",
                "s3:ListBucket",
                "s3:DeleteObject"
            ],
            "Resource": [
                "arn:aws:s3:::your-s3-bucket-name",
                "arn:aws:s3:::your-s3-bucket-name/*"
            ],
            "Effect": "Allow"
        }
    ]
}
```

となります。作成したらユーザを作成し、このポリシーを紐付けておきましょう。

※ここまでの操作をAWS CDKで記述したものが[こちら](https://github.com/cumet04/sbox_storybook-on-pullreq/tree/20201208_zenn/infra)にあるので参考まで。

またユーザが作成できたらユーザのアクセスキーを作成し、アクセスキー及びシークレットキーをgithubのリポジトリに設定しておきます（github actionsから参照します）。
リポジトリページのSettings > Secretsより設定しますが、本記事では`AWS_ACCESS_KEY_ID`にアクセスキー、`AWS_SECRET_ACCESS_KEY`にシークレットキー、`BUCKET_NAME`にS3バケットの名前を入れます。

# github actionsを作る
ここまででインターネットに公開しない（アクセス制限された）webホスティング環境が用意できたため、あとはいい感じにstorybookをビルドしてアップロードすればOKです。

具体的に実施したいことは以下です:
- `main`ブランチ^[既存プロジェクトでは`master`が多数派でしょうか]およびpullreqごとに`build-storybook`しS3にアップロード
- pullreqの場合はアップロードされたS3上のURLをpullreqにコメント
- pullreqがcloseされたら該当ファイルをS3上から消す

以降でも部分ごとにコードを提示しますが、先に全体を置いておきます（長いので折りたたみ）。

:::details actions定義全体
```yml:.github/workflows/storybook.yml
name: deploy storybook
on:
  push:
    branches: [main]
    paths:
      - frontend
      - .github/workflows/storybook.yml
  pull_request:
    types: [opened, reopened, synchronize, closed]
    paths:
      - frontend
      - .github/workflows/storybook.yml
jobs:
  deploy:
    runs-on: ubuntu-latest
    if: github.event.action != 'closed'
    defaults:
      run:
        working-directory: frontend
    steps:
      # storybookのビルド
      - uses: actions/checkout@v2
      - name: Setup Node.js for use with actions
        uses: actions/setup-node@v2.1.2
        with:
          node-version: 14.15.1
      - name: Install Dependencies
        run: npm ci
      - name: Build storybook
        run: npm run build-storybook
      # S3へのアップロード
      - name: set upload destination directory name
        run: |
          DEST_DIR=${{ github.event.pull_request.number }}
          [ -z $DEST_DIR ] && DEST_DIR=main
          echo "DEST_DIR=${DEST_DIR}" >> $GITHUB_ENV
      - name: upload storybook-static
        run: |
          aws s3 cp --recursive \
            ./storybook-static \
            s3://${{ secrets.BUCKET_NAME }}/storybook/${DEST_DIR}
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          AWS_DEFAULT_REGION: ap-northeast-1
      # pullreqへのURLコメント
      - name: post preview url to pull-request
        if: github.event.action == 'opened'
        uses: actions/github-script@v3
        with:
          script: |
            github.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: 'storybook preview created!!\n' +
                'https://${{ secrets.BUCKET_NAME }}.s3-ap-northeast-1.amazonaws.com/storybook/${{ github.event.pull_request.number }}/index.html'
            })
  clean:
    runs-on: ubuntu-latest
    if: github.event.action == 'closed'
    steps:
      - name: remove storybook-static
        run: |
          DEST_DIR=${{ github.event.pull_request.number }}
          aws s3 rm --recursive \
            s3://${{ secrets.BUCKET_NAME }}/storybook/${DEST_DIR}
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          AWS_DEFAULT_REGION: ap-northeast-1
```
※フロントエンド系のファイルは`frontend`がルートになっている想定です
:::

それではブロックごとにポイントを見ていきます。

## `on`セクション
```yaml
on:
  push:
    branches: [main]
    paths:
      - frontend
      - .github/workflows/storybook.yml
  pull_request:
    types: [opened, reopened, synchronize, closed]
    paths:
      - frontend
      - .github/workflows/storybook.yml
```

actionsの発火条件は、mainブランチの更新・pullreqの更新系・pullreqのcloseです。
ポイントとしては`pull_request.types`を指定している点です。[デフォルトでは`opened`, `reopened`, `synchronize`のみ](https://docs.github.com/en/free-pro-team@latest/actions/reference/events-that-trigger-workflows#pull_request)ですが、本件では`closed`を加える必要があるために明示的に指定しています。

また`paths`フロントエンド関連のディレクトリとactionsの定義ファイルを指定しておきます^[後者が忘れがちなので注意しましょう。もちろん筆者は忘れていました]。


## `jobs.deploy`セクション
```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    if: github.event.action != 'closed'
    defaults:
      run:
        working-directory: frontend
    steps:
```

jobsはビルド＆デプロイのセクションとpullreq close時の掃除用セクションに分かれています。
そのため`deploy`セクション全体を`if: github.event.action != 'closed'`することでclose時に発火しないようにしています。

また以降のstepはすべて`frontend`ディレクトリ下で実行するため、`defaults.run.working-directory`を指定しています。

### storybookのビルド
```yaml
      - uses: actions/checkout@v2
      - name: Setup Node.js for use with actions
        uses: actions/setup-node@v2.1.2
        with:
          node-version: 14.15.1
      - name: Install Dependencies
        run: npm ci
      - name: Build storybook
        run: npm run build-storybook
```

ここでは`npm run build-storybook`できればよいので、github actionsでnodejsプロジェクトを扱う際のテンプレのようなstepが並んでいます。そして最後にビルドします。

### S3へのアップロード
```yaml
      - name: set upload destination directory name
        run: |
          DEST_DIR=${{ github.event.pull_request.number }}
          [ -z $DEST_DIR ] && DEST_DIR=main
          echo "DEST_DIR=${DEST_DIR}" >> $GITHUB_ENV
      - name: upload storybook-static
        run: |
          aws s3 cp --recursive \
            ./storybook-static \
            s3://${{ secrets.BUCKET_NAME }}/storybook/${DEST_DIR}
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          AWS_DEFAULT_REGION: ap-northeast-1
```

1つ目のstepではS3にアップロードする際のパスを決定しています。shellなので少々ややこしいですが、javascript風に書くと
```javascript
dest_dir = github.event.pull_request.number || 'main'
GITHUB_ENV["DEST_DIR"] = dest_dir
```
のような雰囲気です。pullreqの番号もしくはブランチ名（main）を設定し、`$GITHUB_ENV`に書き込むことで次以降のstepでこの値を使うことができます。

次のstepにてawsコマンドでビルド成果物をS3にアップロードします。転送先のパスの最後に上記で設定した`DEST_DIR`を使っており、また作成したIAMユーザのアクセスキー・シークレットキーもここで環境変数として指定しています。
ちなみに、github actionsで`ubuntu-latest`などのマシンを動かすとデフォルトで`aws`コマンドが使えるようです。便利ですね。

### pullreqへのURLコメント
```yaml
      - name: post preview url to pull-request
        if: github.event.action == 'opened'
        uses: actions/github-script@v3
        with:
          script: |
            github.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: 'storybook preview created!!\n' +
                'https://${{ secrets.BUCKET_NAME }}.s3-ap-northeast-1.amazonaws.com/storybook/${{ github.event.pull_request.number }}/index.html'
            })
```

S3のURLをpullreqにコメントしています。pullreqの最初にしかいらないので`if: github.event.action == 'opened'`で実行条件を絞っています。

使っている[actions/github-script](https://github.com/actions/github-script)ですが、雑に説明すると「javascript版のoctokitをactions内で使えるようにしたもの」のようです。[issue comment作成のドキュメント](https://octokit.github.io/rest.js/v18#issues-create-comment)の通りにパラメータを指定し、コメント本文にURLを含めた上で実行しています。

書き込み対象がactionsの親リポジトリだからか特にtokenなどの指定は不要なようです。一時的にリポジトリをprivateにしても動作しました。

## `jobs.clean`セクション
```yaml
  clean:
    runs-on: ubuntu-latest
    if: github.event.action == 'closed'
    steps:
      - name: remove storybook-static
        run: |
          DEST_DIR=${{ github.event.pull_request.number }}
          aws s3 rm --recursive \
            s3://${{ secrets.BUCKET_NAME }}/storybook/${DEST_DIR}
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          AWS_DEFAULT_REGION: ap-northeast-1
```

`if: github.event.action == 'closed'`にてpullreqのclose時（merge含む）に動作し、該当pullreqのstorybookファイルを削除します。
アップロード時と同じように該当パスを`aws rm`で消しているだけのシンプルなjobです。


# まとめ
以上の準備とコードがあれば、あとはいつものようにコードを書いてpullreqを作りmergeし...としているだけで、おもむろにstorybookのURLが飛んできます。後片付けだって完璧です。

![pullreq comment](https://storage.googleapis.com/zenn-user-upload/zrzsiil7xsdsd7d8frv0zchctji2)

actionsの定義は少々長いですが、一つ一つ見ていくと案外単純だったのではないでしょうか。

というわけで、みなさんもどんどんプレビューしましょう！
