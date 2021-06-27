---
title: "GitHub ActionsからprivateなWeb APIを叩く"
emoji: "✨"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [githubactions, aws, lambda]
published: false
---

なんやかんやで別のサービスに移行されず、EC2で立ててIP制限して秘伝のタレ的に運用されてるサーバ、ありますよね。Jenkinsに始まりRedmineにredash、Zabbixとか。

作業フローの効率化のためそれらを外部の何かと連携させようと考えるも、IP制限に阻まれて難しい。ありますよねそういうの。接続元IPが絞れないみたいなの。

そこで、IP制限されたEC2サーバに対し、GitHub Actionsを起点にAWS Lambdaを経由させてWebAPIを呼ぶ、ということをやってみます。

:::message
本記事では対象のサーバがAWSでEC2として動いていることを想定しています。しかし似た考え方でGCPやAzureの場合でもできるとは思います。オンプレは...対象外です。
:::

:::message alert
ここで紹介する方法は、接続制限に対して一種の穴を開けるものです。実施する際は、通信経路全体の認証系や穴として開ける部分の権限の強さ・脆弱性などに十分気をつけてください。
:::

## TL;DR
インターネットからの接続がIP制限されているEC2サーバに対し、VPC内に設置したLambdaからWebAPIをキックするようにし、そのLambdaをGitHub Actionsからawscliを使って起動する、というデモをします。

## 前提状況を作る
始める前に、前提とない「IP制限されたWebサーバ」を作ります。
動作確認としてはIP制限されておりwebアクセス可能なサーバがあれば良いです。

筆者は[こういう一時的な実験に使う用のEC2起動テンプレート](https://zenn.dev/cumet04/articles/ssm-ec2-sandbox-template)があるのでそれを使いました。
AmazonLinux2のインスタンスを起動後、`sudo yum install httpd`して`sudo systemctl start httpd`しておきます。

制限したIPアドレスからcurlなどでTestPageが確認でき、それ以外のIPアドレスからは見えなければokです。

## アクセスの起点を作る
APIへのアクセスの起点として、LambdaをVPC内に設置します。

:::message
LambdaをVPC内に配置することでサブネット内からAPIアクセスできるようにし、インターネットから直接WebAPIを呼ばずにそのLambdaを呼ぶ、という算段です。
実質的にインターネットからアクセスするプロキシとして機能させ、認証機能をAWSのAPIアクセスに、認可（というより実行できるアクションの制限）をLambda関数に移譲するかたちです。
:::

AWSコンソールよりLambda関数を作成しますが、ポイントは詳細設定よりVPCを選択する点です。
Webサーバと同じVPCと適当なサブネットを選びます。セキュリティグループはアウトバウンドが通っていれば良く、インバウンドはルール無しで問題ありません。
関数名とランタイムもお好きなもので良いですが、ここではRuby2.7で`kick-private-api`という関数を作成しました。

ここではHTTPリクエストが通ることだけ確認できれば良いので、ごく最低限で以下のコードを用意しました。^[statusCodeが固定値なのはただのミスです。。。が、ここではその程度のざっくりテストで良いということでそのまま。]
```ruby
require 'json'
require 'net/http'
require 'uri'

def lambda_handler(event:, context:)
    resp = Net::HTTP.get(URI.parse('http://172.31.31.12/'))
    { statusCode: 200, body: JSON.generate(resp) }
end
```

あとは、APIサーバのセキュリティグループにて上記Lambda関数からの80番通信を許可（CIDRもしくは送信元セキュリティグループなどで指定）しておき、Lambda関数をテスト実行します。

![](https://storage.googleapis.com/zenn-user-upload/87d0c76bbe41e2d0f043fca4.png)

上記のようにレスポンスが返ってきていればokです。

### API Keyにアクセスする
プライベートにせよパブリックにせよ、WebAPIにアクセスする場合はAPI Keyのようなシークレット情報を使う場合が多いと思います。
そのような場合、AWSではSystem Manager パラメータストアにSecureStringとしてキーを保存する選択肢がありますが、Lambda in VPCからパラメータストアにアクセスするにはVPCエンドポイントの作成が必要です。

https://aws.amazon.com/jp/premiumsupport/knowledge-center/lambda-vpc-parameter-store/

AWSコンソールからVPCエンドポイントを作成しますが、
* サービスとして com.amazonaws.ap-northeast-1.ssm を選択
* Lambdaと同じVPCに配置
* 「プライベートDNS名を有効にする」にチェック
* Lambdaから443ポートが通るセキュリティグループを設定

が満たされていればokです。またポリシーはデフォルトのままフルアクセスにしました。

上記準備ができたらAPI Key相当のパラメータを作成します。パラメータストアの画面より適当なSecureStringのパラメータを作ります。ここでは名前を`/kick-private-api/key`に、値を`kick-private-api-some-secret-key`としました。

また、Lambda関数に紐付けられたIAMロールにパラメータの読み取り権限を付与しておきます。付与するポリシーは下記のようになります。
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "VisualEditor0",
            "Effect": "Allow",
            "Action": "ssm:GetParameter",
            "Resource": "arn:aws:ssm:ap-northeast-1:000000000000:parameter/kick-private-api/key"
        }
    ]
}
```
※ARNのアカウント番号は伏せています

準備ができたらLambdaの実行コードを少々書き換えます。
```ruby
require 'json'
require 'net/http'
require 'uri'
require 'aws-sdk-ssm'

def lambda_handler(event:, context:)
    key = Aws::SSM::Client.new.get_parameter(name: '/kick-private-api/key', with_decryption: true)[:parameter][:value]
    
    resp = Net::HTTP.get(URI.parse("http://172.31.22.249/#{key}"))
    { statusCode: 200, body: JSON.generate(resp) }
end
```
`aws-sdk-ssm`をrequireして普通に使います。また、ここでは読み込めていることさえわかればよいので、keyを適当にリクエストパスに突っ込んでいます。
実行後、サーバ側のアクセスログにkey名のリクエストがあればokです。

![](https://storage.googleapis.com/zenn-user-upload/4de96a8cc8d17dc5ec376708.png)

:::message alert
EC2は言わずもがなですが、VPCエンドポイントも存在しているだけで課金が発生します。遊び終わったら削除しておきましょう。
:::


## スクリプトから実行できるようにする
作成したLambdaをGitHub Actionsなどのスクリプトから実行できるようにします。

まずはそのままawscli経由で実行できることを確認します。awscliがセットアップされたローカル環境もしくはCloudShellから
```
aws lambda invoke --function-name kick-private-api out
```

のように実行し、`./out`ファイルにレスポンスが記録されていれば成功です。

次に適切なIAMユーザを作成し、その権限を使って実行できることを確認します。下記のポリシーでIAMユーザを作成します。

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "VisualEditor0",
            "Effect": "Allow",
            "Action": "lambda:InvokeFunction",
            "Resource": "arn:aws:lambda:ap-northeast-1:000000000000:function:kick-private-api"
        }
    ]
}
```

ユーザを作成したらアクセスキー・シーキレットキーを発行し、
```
$ export AWS_ACCESS_KEY_ID=xxxxx
$ export AWS_SECRET_ACCESS_KEY=xxxx
$ aws s3 ls # 関係ない権限がついてないことをざっと確認
An error occurred (AccessDenied) when calling the ListBuckets operation: Access Denied
$ aws lambda invoke --function-name kick-private-api out
```

最初のテストのように`./out`にレスポンスがあれば成功です。

ここまでできれば、あとはこのユーザ権限を使ってActions（やその他BotやCIなど）から実行すればokですね。


## GitHub Actionsから実行する
上記Lambda関数を実行するActionsを作ります。
最低限実行テストができれば良いので、簡単にworkflow_dispatchのものを作り、ブラウザから実行します。

まず実行したいリポジトリを用意し、リポジトリページのSettings > Secretsより実行IAMユーザのキーを入れておきます。
名前は環境変数と同じく`AWS_ACCESS_KEY_ID`と`AWS_SECRET_ACCESS_KEY`とします。

そしてごく最低限のactions定義ファイルを書きます。
```yaml:.github/workflows/kick-lambda.yml
name: kick-lambda

on:
  workflow_dispatch:

jobs:
  invoke:
    runs-on: ubuntu-latest
    steps:
      - name: invoke lambda
        run: |
          aws lambda invoke --function-name kick-private-api out
          echo 'ok, output is:'
          cat out
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          AWS_DEFAULT_REGION: ap-northeast-1
```

メインブランチにcommit & pushしたら、リポジトリページのActionsタブから該当のものを選び、Run workflowsします。

![](https://storage.googleapis.com/zenn-user-upload/be260e37a42f0aa9afc140da.png)

実行ログを確認し、レスポンスが返ってきている様子が見えればokです。

## まとめ
非常に簡易的ですが、GitHub ActionsをキックしてprivateなWeb APIを叩くことができました。
このアイデアはActionsに限らずSlack Botなどでも同様に活用でき、様々な活用方法がありそうです。

あとはLambdaとActions（やbotなど）をそれぞれ作り込めば、いろんな効率化が図れそうですね。
