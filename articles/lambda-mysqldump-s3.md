---
title: "Lambdaでシンプルにmysqldump to S3を試みる"
emoji: "👌"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [lambda,mysql,rds]
publication_name: "litalico"
published: true
---

この記事は [LITALICO Engineers Advent Calendar 2022](https://qiita.com/advent-calendar/2022/litalico) その1 の6日目の記事です。

RDSから日次でmysqldumpしてS3に投げたいことありますよね。なんやかんやでローカルのダミーデータ生成がうまく機能しておらず、マスクした本番データをローカルで使ってる場合とか。

EC2の時代はシンプルにshell scriptを書いてcronしていたのですが、正直アプリケーション固有要素がなさすぎて、独立したlambdaを作って使いまわしたいと前々から思っていました。

しかしながら「lambda mysqldump」などでググるとこう...メンテ終了したnpmパッケージを使ったものや、ローカルやEC2から引っこ抜いたmysqldumpバイナリをpythonですごいゴニョゴニョするようなものしか出てきません。

いやーshell scriptなら数行で済むのに...しかもバイナリの手配がゴリ押しというかそれリポジトリに入れるの？といったモヤモヤが拭えません。

というわけで、もっとシンプルにならないか？と試してみました。


## 方針を考える

:::message
ここからは試行錯誤込みの作業記録のため、寄り道成分も多く含まれますのでご了承ください。手っ取り早く成果物を見たい方は[記事最後のセクション](#最終成果物)を参照ください。

またAWSのリソースや操作についてはある程度知っている前提として、細かい操作や手順はあまり記載していません。
:::

shellベースならシンプルにできるということは分かっているので、lambdaでshellを動かす方向を模索します。すると[カスタムランタイム](https://docs.aws.amazon.com/ja_jp/lambda/latest/dg/runtimes-custom.html)というものがあり、サンプル実装がまさにshellで書かれていることがわかります。またベース環境はAmazonLinux2のようです。

これや！これにyumでmysqldumpとawscli入れたら勝利や！欲しかったのはこれなんや！


## ローカルで試す
実装イメージは見えたので、実際に組み上げていきます。

カスタムランタイムを使ったLambdaの作り方については、下記公式チュートリアルを参照します。詳細は適当に作りやすいように組んでいきますが、大まかな流れやサンプルスクリプトは有用です。

https://docs.aws.amazon.com/ja_jp/lambda/latest/dg/runtimes-walkthrough.html

作るのはLambdaなので最終的にはAWSコンソールなりCLIで作りますが、一般的にこの手のネタは簡単に見えても試行錯誤が多くなるものです。初手で高速な試行錯誤ができる環境を作っておくとトータルで楽だと見ました。

幸い[カスタムランタイムのベースイメージ](https://docs.aws.amazon.com/ja_jp/lambda/latest/dg/runtimes-images.html#runtimes-images-custom)が用意されているので、dump対象のmysqlともどもdocker composeで作ってしまいましょう。というわけで[ベースイメージのページ](https://gallery.ecr.aws/lambda/provided)のUsageを参考にしつつ出来たのがこちら。

```yml:docker-compose.yml
version: "3"

services:
  lambda:
    image: public.ecr.aws/lambda/provided:al2
    command: function.handler
    volumes:
      # bootstrap と function.sh はそれぞれ /var/runtime/ と /var/task/ 配下に設置する必要があり
      # その事情に合わせるためにローカルのディレクトリでもそのようなファイル配置にしている
      - ./runtime:/var/runtime
      - ./task:/var/task
    environment:
      # awscliの認証情報はdocker compose実行元から環境変数で渡す想定
      - AWS_ACCESS_KEY_ID
      - AWS_SECRET_ACCESS_KEY
      - AWS_SESSION_TOKEN

  # ベースイメージのUsageによると、このイメージはコンテナの外からcurlすることで発火できるとのことなので
  # 発火用のコンテナ（というよりコマンドスニペット）もcompose内に用意する
  invoker:
    image: curlimages/curl
    # sh + echoをしないとcurlの出力に末尾改行が含まれず、docker composeのログにflushされない
    command: sh -c 'curl -s -XPOST "$$URL" -d "$$DATA"; echo ""'
    environment:
      - URL=http://lambda:8080/2015-03-31/functions/function/invocations
      - DATA={"payload":"hello world!"}
    depends_on:
      - lambda

  db:
    image: mysql:8.0
    # mysql:8.0 ではCLIで雑にパスワード認証する場合はこのオプションが必要
    command: --default-authentication-plugin=mysql_native_password
    environment:
      MYSQL_ROOT_PASSWORD: password
    volumes:
      - db:/var/lib/mysql

volumes:
  db:
```

チュートリアルページを参照しつつ、サンプルコードをそのままコピペした`bootstrap`と`function.sh`をそれぞれ`./runtime/bootstrap`と`./task/function.sh`として配置しておきます。これで`docker compose up`すると以下のようにサンプル関数が動作するログが確認できます。

```
$ docker compose up --attach lambda --attach invoker # mysqlのログがうるさいのでlambdaとcurlのログだけ表示する
[+] Running 3/3
 ⠿ Container lambda-simple-mysqldump-s3-db-1       Cr...                                             0.0s
 ⠿ Container lambda-simple-mysqldump-s3-lambda-1   Recreated                                         0.1s
 ⠿ Container lambda-simple-mysqldump-s3-invoker-1  Recreated                                         0.1s
Attaching to lambda-simple-mysqldump-s3-invoker-1, lambda-simple-mysqldump-s3-lambda-1
lambda-simple-mysqldump-s3-lambda-1   | 03 Dec 2022 06:34:22,959 [INFO] (rapid) exec '/var/runtime/bootstrap' (cwd=/var/task, handler=)
lambda-simple-mysqldump-s3-lambda-1   | 03 Dec 2022 06:34:24,023 [INFO] (rapid) extensionsDisabledByLayer(/opt/disable-extensions-jwigqn8j) -> stat /opt/disable-extensions-jwigqn8j: no such file or directory
lambda-simple-mysqldump-s3-lambda-1   | 03 Dec 2022 06:34:24,023 [WARNING] (rapid) Cannot list external agents error=open /opt/extensions: no such file or directory
lambda-simple-mysqldump-s3-lambda-1   | START RequestId: 5d335091-0a81-4a32-9002-c326b5fffed3 Version: $LATEST
lambda-simple-mysqldump-s3-lambda-1   | {"payload":"hello world!"}
lambda-simple-mysqldump-s3-lambda-1   |   % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
lambda-simple-mysqldump-s3-lambda-1   |                                  Dload  Upload   Total   Spent    Left  Speed
100    61  100    16  100    45  27118  76271 --:--:-- --:--:-- --:--:-- 61000
lambda-simple-mysqldump-s3-lambda-1   | {"status":"OK"}
lambda-simple-mysqldump-s3-lambda-1   | END RequestId: 5d335091-0a81-4a32-9002-c326b5fffed3
lambda-simple-mysqldump-s3-lambda-1   | REPORT RequestId: 5d335091-0a81-4a32-9002-c326b5fffed3  Init Duration: 0.64 ms    Duration: 60.40 ms      Billed Duration: 61 ms  Memory Size: 3008 MB    Max Memory Used: 3008 MB
lambda-simple-mysqldump-s3-invoker-1  | Echoing request: '{"payload":"hello world!"}'
lambda-simple-mysqldump-s3-invoker-1 exited with code 0
```

よさそう。微妙にwarningメッセージが出ているのが気になりますが、その後に見慣れたLambdaのログが見えるのできっと大丈夫でしょう。あとはソースコードを調整していけば目的まで辿り着けそうに見えます。

また、念のためlambdaコンテナにbashで入り、yum installやmysqlへの疎通が出来ることを確認しておきます。


## サンプルコードを読む
それでは実際のコードを書いていく...前に、サンプルを読んでみます。

```bash
#!/bin/sh

set -euo pipefail

# Initialization - load function handler
source $LAMBDA_TASK_ROOT/"$(echo $_HANDLER | cut -d. -f1).sh"

# Processing
while true
do
  HEADERS="$(mktemp)"
  # Get an event. The HTTP request will block until one is received
  EVENT_DATA=$(curl -sS -LD "$HEADERS" -X GET "http://${AWS_LAMBDA_RUNTIME_API}/2018-06-01/runtime/invocation/next")

  # Extract request ID by scraping response headers received above
  REQUEST_ID=$(grep -Fi Lambda-Runtime-Aws-Request-Id "$HEADERS" | tr -d '[:space:]' | cut -d: -f2)

  # Run the handler function from the script
  RESPONSE=$($(echo "$_HANDLER" | cut -d. -f2) "$EVENT_DATA")

  # Send the response
  curl -X POST "http://${AWS_LAMBDA_RUNTIME_API}/2018-06-01/runtime/invocation/$REQUEST_ID/response"  -d "$RESPONSE"
done
```

若干のshell芸力と勘が求められるコードですが、ざっくりとした流れは
1. ハンドラのコードをロードしておく
2. 専用のエンドポイントにGETリクエストを送り、ハンドラに渡すイベントを取得する
3. イベントデータを引数にしてハンドラ関数を呼ぶ
4. ハンドラの戻り値を専用のエンドポイントにPOSTで返す
5. 2-4でループ

と読めます。

2がロングポーリングで待っていることや、ハンドラ実行がループになっていることから、1実行単位（プロセス？インスタンス？）で複数回の呼び出しをハンドリングするアーキテクチャであることが読み取れます。

実際に下記ドキュメントを読むとそうなっていることがわかります。
https://docs.aws.amazon.com/ja_jp/lambda/latest/dg/lambda-runtime-environment.html

「コールドスタート」と呼ばれているのは、このインスタンスが起動していなかった場合の待ちだったのか。なるほどなー。

と、少々脱線しましたがもとに戻り、function.shはこうです。

```bash
function handler () {
  EVENT_DATA=$1
  echo "$EVENT_DATA" 1>&2;
  RESPONSE="Echoing request: '$EVENT_DATA'"

  echo $RESPONSE
}
```

shellのlambdaサンプルなど見たことはありませんが、あったとしたらこうなのだろうというシンプルな関数です。関数内全体がほぼアプリケーションコードなのでしょう。

また、関数自体はループで都度実行ですが、関数の外はbootstrapの最初に一度評価されるのみです。ということは、ここにセットアップコード（yum installなど）を書けそうです。


## コードを書く・ローカルで試す
というわけで、必要なコードをざっと書いたものがこちら。

```bash:task/function.sh
# AmazonLinux2ベースのイメージでありmysqlパッケージは無い。のでmysqldumpはmariadbのもので代用
yum install -y gzip awscli mariadb

# オプションが長すぎるので関数にしてわかりやすくする
function getparam() {
  aws ssm get-parameter --with-decryption --region ap-northeast-1 --name $1 --query 'Parameter.Value' --output text
}
export DBUSER=$(getparam sbox-mysqldump-dbuser)
export DBHOST=$(getparam sbox-mysqldump-dbhost)
export DBNAME=$(getparam sbox-mysqldump-dbname)
export DBPASS=$(getparam sbox-mysqldump-dbpass)

function handler () {
  filename=$(date '+%Y-%m-%d_%H%M%S').sql.gz

  mysqldump -u $DBUSER -h $DBHOST $DBNAME -p$DBPASS | \
    gzip | \
    aws s3 cp - s3://sbox-lambda-simple-mysqldump-s3/dump/$filename
    # バケット名やパスはコード内に決め打ち

  echo $filename
}
```

DB接続情報は実際のユースケースを想定してSSMパラメータストアのSecureStringを使っています。その取得処理が入って少々コードが長いですが、許容範囲かなと思います。AWSさん、LambdaでもECSみたいにパラメータストアをいい感じに使えるようにしてくれ～

:::message
パラメータはLambda関数自体の環境変数設定に直接入れる手もあります。その場合はこれらのコードはまるごと不要になります。
:::

また、dump -> gzip -> s3のコマンドは下記ブログを参考にしました。lambdaでも実行環境リソースは少々気になる上、なによりシンプルに書けてうれしいですね。
https://rooter.jp/infra-ops/mysql_dump_s3_directly/

ここまででコードが出来たので、動かしてみます。DBの中身は予め適当にcreate databaseとcreate tableしてinsertしておきます。またパラメータストアに接続情報を入れておきます。対象はローカルなのでローカルの情報を。そしてアップロード先のS3バケットも作っておきます。

そしてdocker compose upすると

![](/images/lambda-mysqldump-s3/s3-uploaded.png)

できた！ローカルテストは完璧ですね。


## AWS環境で動かしてみる
では実際の環境を作ってみます。とはいえS3とパラメータストアは既にあるので、残るはMySQLとLambdaです。

MySQLはなんでもいいのですが、料金面でテストに使いやすい（scale to zeroがある）と噂に聞くAurora serverless v1を試してみます。AWSコンソールから適当にポチポチ作ります。新規作成できserverless v1に対応しているのは Aurora 2.07.1 のみ（執筆時点）なのでそれを選択します。またscale to zeroはデフォルトでは有効になっていないので「インスタンスの設定」セクションの下の方から選んでおきます。

![](/images/lambda-mysqldump-s3/aurora.png)

残りの設定は適当で良いですが、Lambdaからの接続を想定するので、そのようなセキュリティグループを設定しておきます。テストであればVPC内の全IPから許可というのが楽でしょう。

なお初期データ投入はなんやかんやで作業用EC2を作ってしまうのが早いです。yumでクライアントをセットアップし、データを適当に作って閉じておきます。DBセットアップが終わったら、パラメータ読み込み用のSSMパラメータストアの値を作成したインスタンスに合わせて変更しておきます。

次に本命のLambda関数を作ります。ポイントはカスタムランタイムをAmazonLinux2にしておくこと・（VPC内にあるAuroraに繋ぐので）VPC内に関数を設置すること、です。

![](/images/lambda-mysqldump-s3/create-lambda-1.png)
※実際のVPCやサブネットなどは適当に選びます

実行ロールはこのLambda作成画面に自動で作ってもらったあと、S3とパラメータアクセスのため手動で下記ポリシーを追加しました。

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "VisualEditor0",
            "Effect": "Allow",
            "Action": "s3:PutObject",
            "Resource": "arn:aws:s3:::sbox-lambda-simple-mysqldump-s3/dump/*"
        },
        {
            "Sid": "VisualEditor1",
            "Effect": "Allow",
            "Action": "ssm:GetParameter",
            "Resource": "arn:aws:ssm:ap-northeast-1:xxxxxxxxxxxx:parameter/sbox-mysqldump-*"
        }
    ]
}
```

<!-- MEMO: kmsのdecryptいらないのか？と思い検証したが、少なくともAWSマネージドの鍵を使う分には無くても動くっぽい？ -->

また、VPC内に配置した関数内からSSMやS3にアクセスする関係上、VPC内からそれらにアクセスする経路を用意する必要があります。要するにNATゲートウェイやVPCエンドポイントが必要です。筆者の場合は簡単にNATゲートウェイを用意しました。

:::message alert
NATゲートウェイにしてもVPCエンドポイントにしても、本記事内で使うリソースにしては料金が高めのため、遊び終わったら消すなど気をつけましょう
:::

さてこのまま関数を作成すると、見慣れたLambdaのエディタ画面が見えますね。

![](/images/lambda-mysqldump-s3/lambda-editor.png)

bootstrapもfunctionも手元で動作確認済みのものがあるので、renameしつつそのまま突っ込んでみます。ローカルテストを信じるならそのまま動くはず。

ではいつものように適当なテストデータを作り、テスト発火します。さあ！

> **Function Logs**
> /var/task/function.sh: line 2: yum: command not found
> /var/task/function.sh: line 2: yum: command not found
> START RequestId: 2b1bd18c-bcc6-4cec-814a-1f410bf1336f Version: $LATEST
> RequestId: 2b1bd18c-bcc6-4cec-814a-1f410bf1336f Error: Runtime exited with error: exit status 127
> Runtime.ExitError
> END RequestId: 2b1bd18c-bcc6-4cec-814a-1f410bf1336f
> REPORT RequestId: 2b1bd18c-bcc6-4cec-814a-1f410bf1336f	Duration: 83.18 ms	Billed Duration: 84 ms	Memory Size: 128 MB	Max Memory Used: 4 MB

ん？

> /var/task/function.sh: line 2: yum: command not found

そんなあ。


## Dockerイメージを試す
ベースイメージにはあったyumが、実環境のLambda上には無いということがわかりました。初手でローカル環境整備を入念にやったことが裏目に出てしまいました。残念。

とはいえ問題はツールのインストールだけで、スクリプトなどはそのまま使えるはずです。また別の方向を試すにしてもローカル環境は整備されており、Dockerであれば試行錯誤はしやすい状態です。

ということで、Lambda用のカスタムDockerイメージを作って動かす方向性を試してみます。自分で用意したイメージをアップロードして使うのであれば、環境差異は無いはずです。その方式のドキュメントはこちら。

https://docs.aws.amazon.com/ja_jp/lambda/latest/dg/images-create.html

:::message
Dockerイメージを作る方法の他に、必要なコマンドを事前に取り出してアップロードする形式も試しましたが、微妙な問題が多いこととシンプルさが失われすぎることから不採用としました。

学びが少ないので詳細は記事にはしませんが、興味がある方は下記スレッドを参照ください。ECRを使いたくないといった制約がある場合には有効かもしれません。
https://zenn.dev/link/comments/4b282c05da5b84
:::

実行環境がカスタムなDockerイメージ内ということを除けば、bootstrapやfunction.shはそのままの仕組みで動作します。ということは、yum installをスクリプト内からDockerfileに移せばそれだけで動くはずです。

ということで

```dockerfile:Dockerfile
FROM public.ecr.aws/lambda/provided:al2

RUN yum install -y gzip mariadb awscli && \
  yum clean all && rm -rf /var/cache/yum

COPY runtime/bootstrap ${LAMBDA_RUNTIME_DIR}
COPY task/function.sh ${LAMBDA_TASK_ROOT}

CMD [ "function.handler" ]
```

```diff:function.sh
-# AmazonLinux2ベースのイメージでありmysqlパッケージは無い。のでmysqldumpはmariadbのもので代用
-yum install -y gzip mariadb awscli
-
 # オプションが長すぎるので関数にしてわかりやすくする
 function getparam() {
   aws ssm get-parameter --with-decryption --region ap-northeast-1 --name $1 --query 'Parameter.Value' --output text
```

```diff:docker-compose.yml
 services:
   lambda:
-    image: public.ecr.aws/lambda/provided:al2
+    build:
+      context: .
     command: function.handler
     volumes:
```

一応ローカルで試しますが、動きます。まぁそうですよね。

:::details サイドトピック: イメージサイズの圧縮

ここで、Dockerイメージのサイズについて考えます。一般にデプロイするDockerイメージのサイズは小さい方が良いことが多いです。というわけで、実行イメージには必要なバイナリのみを載せる方向にしてみます。

```dockerfile:Dockerfile
FROM public.ecr.aws/lambda/provided:al2 as build

RUN yum install -y gzip mariadb unzip

ADD https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip /opt/awscli.zip
RUN cd /opt && unzip -q awscli.zip

FROM public.ecr.aws/lambda/provided:al2

COPY --from=build /usr/bin/gzip /usr/bin/mysqldump /usr/local/bin/
COPY --from=build /opt/aws /opt/aws
RUN ln -s /opt/aws/dist/aws /usr/local/bin/
```

gzipとmysqldumpはバイナリだけ取り出しました。またawscliのパッケージは取り出しにくいので、zip配布のやつにしました。v1からv2に変わっていますが、今回のユースケースならどっちでも良いでしょう。

ここでレイヤのサイズを見てみます。まず最初のyumでシンプルに入れるだけのパターン

```
$ docker history lambda-local
IMAGE          CREATED         CREATED BY                                      SIZE      COMMENT
a0c7ad338830   3 seconds ago   /bin/sh -c yum install -y gzip mariadb awscl…   250MB
bdd84b649c1d   11 days ago     ENTRYPOINT [ "/lambda-entrypoint.sh" ]          0B
...
```

続いてバイナリなどを取り出したパターン

```
$ docker history lambda-local
IMAGE          CREATED             CREATED BY                                      SIZE      COMMENT
3b5f2bd5f2ad   About an hour ago   /bin/sh -c ln -s /opt/aws/dist/aws /usr/loca…   17B
d32fee162833   About an hour ago   /bin/sh -c #(nop) COPY dir:71e7a6526e5cb2598…   168MB
028557407f88   About an hour ago   /bin/sh -c #(nop) COPY multi:b3e5c2b0ab7627b…   3.27MB
bdd84b649c1d   11 days ago         ENTRYPOINT [ "/lambda-entrypoint.sh" ]          0B
...
```

80MBくらい、30%ちょっとの削減になりました。これ以上はawscliがgolang実装にでもならないと厳しいでしょう。このくらいだと、正直せいぜい1日1回程度しか実行されない関数では実りが少ないし、元の目的である「シンプルにしたい」にもかなり反するので、ここまでしなくていいかなということでサイドトピックに留めました。

ちなみに「ベースイメージがゴツいんじゃないか」という観点がありますが、Lambdaにおいてはむしろこれが良いようです。
https://aws.amazon.com/jp/blogs/news/optimizing-lambda-functions-packaged-as-container-images/

> まず、AWS が提供するベースイメージは、Lambda サービスによってプロアクティブにキャッシュされます。つまり、ベースイメージは近くの別のアップストリームキャッシュにあるか、ワーカーインスタンスキャッシュにすでに存在しています。

:::
<!-- サイドトピックおわり -->

Dockerfileはこれで良いことがわかったので、Lambdaから参照できるようにECRに配備します。ここは特に変わったことはなく、ECRリポジトリを適当に作成し、ビルドしてpushしておきます。


## Lambdaリベンジ
実行イメージは手配できたので再度Lambdaで実行してみます。

前に作った関数は削除し、下記のように「コンテナイメージ」を選びつつ作成します。

![](/images/lambda-mysqldump-s3/lambda-docker.png)

VPC配置やIAMロールなどは前回と同様...なのですが、コンテナイメージの作成画面の場合はVPC配置の設定UIがありません。そこはそのまま作成後、別途設定画面から変更する必要があります。また、Lambdaデフォルトのタイムアウト値である3秒は流石に短いので、適当に30秒ほどに伸ばします。

で、テスト発火すると...ローカルで試したときのように無事S3にデータが出力されました。めでたしめでたし。


## 最終成果物
少々紆余曲折したため、最後に成果物や条件などをまとめます。再掲ですが下記リポジトリにもあります。

https://github.com/cumet04/lambda-simple-mysqldump-s3

まずソースコード系。

:::details Dockerfile

```dockerfile:Dockerfile
FROM public.ecr.aws/lambda/provided:al2

RUN yum install -y gzip mariadb awscli && \
  yum clean all && rm -rf /var/cache/yum

COPY runtime/bootstrap ${LAMBDA_RUNTIME_DIR}
COPY task/function.sh ${LAMBDA_TASK_ROOT}

CMD [ "function.handler" ]
```

:::

:::details task/function.sh

```bash:task/function.sh
function getparam() {
  aws ssm get-parameter --with-decryption --region ap-northeast-1 --name $1 --query 'Parameter.Value' --output text
}
export DBUSER=$(getparam sbox-mysqldump-dbuser)
export DBHOST=$(getparam sbox-mysqldump-dbhost)
export DBNAME=$(getparam sbox-mysqldump-dbname)
export DBPASS=$(getparam sbox-mysqldump-dbpass)

function handler () {
  filename=$(date '+%Y-%m-%d_%H%M%S').sql.gz

  mysqldump -u $DBUSER -h $DBHOST $DBNAME -p$DBPASS | \
    gzip | \
    aws s3 cp - s3://sbox-lambda-simple-mysqldump-s3/dump/$filename

  echo $filename
}
```

:::

:::details runtime/bootstrap

```bash:runtime/bootstrap
#!/bin/sh

set -euo pipefail

# Initialization - load function handler
source $LAMBDA_TASK_ROOT/"$(echo $_HANDLER | cut -d. -f1).sh"

# Processing
while true
do
  HEADERS="$(mktemp)"
  # Get an event. The HTTP request will block until one is received
  EVENT_DATA=$(curl -sS -LD "$HEADERS" -X GET "http://${AWS_LAMBDA_RUNTIME_API}/2018-06-01/runtime/invocation/next")

  # Extract request ID by scraping response headers received above
  REQUEST_ID=$(grep -Fi Lambda-Runtime-Aws-Request-Id "$HEADERS" | tr -d '[:space:]' | cut -d: -f2)

  # Run the handler function from the script
  RESPONSE=$($(echo "$_HANDLER" | cut -d. -f2) "$EVENT_DATA")

  # Send the response
  curl -X POST "http://${AWS_LAMBDA_RUNTIME_API}/2018-06-01/runtime/invocation/$REQUEST_ID/response"  -d "$RESPONSE"
done
```
※チュートリアルのコードと全く同じ

:::

:::details docker-compose.yml (デプロイには不要)

```yml:docker-compose.yml
version: "3"

services:
  lambda:
    build:
      context: .
    command: function.handler
    volumes:
      - ./runtime:/var/runtime
      - ./task:/var/task
    environment:
      - AWS_ACCESS_KEY_ID
      - AWS_SECRET_ACCESS_KEY
      - AWS_SESSION_TOKEN

  invoker:
    image: curlimages/curl
    command: sh -c 'curl -s -XPOST "$$URL" -d "$$DATA"; echo ""'
    environment:
      - URL=http://lambda:8080/2015-03-31/functions/function/invocations
      - DATA={"payload":"hello world!"}
    depends_on:
      - lambda

  db:
    image: mysql:8.0
    command: --default-authentication-plugin=mysql_native_password
    environment:
      MYSQL_ROOT_PASSWORD: password
    volumes:
      - db:/var/lib/mysql

volumes:
  db:
```

:::

実運用には不要な`docker-compose.yml`とサンプルから全く手を入れていない`bootstrap`はノーカウントとして、メインスクリプトである`function.sh`と`Dockerfile`はなかなかシンプルに仕上がったと思います。

次にAWS上に必要なリソースは
* Lambda (VPC内配置)
* S3バケット
* mysqldump対象のDB
* ECRリポジトリ
* VPCエンドポイント or NATゲートウェイ (S3, SSM通信用)
* SSMパラメータストア (DB接続情報保管用。関数の環境変数を使うなら不要)

となっています。並べてみると少々多いように見えますが、前半3つは要件であり、後半にしても通信経路とパラメータは前提として既にあるケースが多く、現実的にはそこまででもないと思います。

VPCエンドポイント or NATゲートウェイがもし既存環境に無くこのためだけに新設する場合（正直あまりないと思いますが[^1]）は、パラメータストアを使わずに環境変数設定を使い、かつS3の代わりにEFSを使えば不要にできるかもしれません。

[^1]: MySQLを使っているがこれら通信経路が無いパターンというと、FargateやEC2にパブリックIPを付与して使っている、もしくはアプリケーションが本当に外部と何も通信しない場合、でしょうか


## まとめ
当初想定とは違うかたちに着地しましたが、結果的にまぁまぁシンプルなものが出来上がったんじゃないでしょうか。少なくともメンテやセットアップ上の不安は少ないクリーンなものにはなったと思っています。

またこの試みを進めていくにあたり、Lambdaの利用パターンや内部挙動を垣間見ることができ、学びも多くありました。やはりこうやって実際に自分で色々試してみるのはよいですね。
